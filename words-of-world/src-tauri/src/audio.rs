use anyhow::{anyhow, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use hound::{SampleFormat, WavSpec, WavWriter};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

#[derive(Serialize, Deserialize, Clone)]
pub struct AudioDevice {
    pub name: String,
    pub is_default: bool,
}

const TARGET_SAMPLE_RATE: u32 = 16_000;

pub struct AudioRecorder {
    is_recording: Arc<AtomicBool>,
    current_file_path: Arc<Mutex<Option<String>>>,
    stop_sender: Mutex<Option<mpsc::Sender<()>>>,
    done_receiver: Mutex<Option<mpsc::Receiver<Result<()>>>>,
}

impl AudioRecorder {
    pub fn new() -> Self {
        Self {
            is_recording: Arc::new(AtomicBool::new(false)),
            current_file_path: Arc::new(Mutex::new(None)),
            stop_sender: Mutex::new(None),
            done_receiver: Mutex::new(None),
        }
    }

    pub fn start_recording(&self) -> Result<String> {
        if self.is_recording.load(Ordering::SeqCst) {
            return Err(anyhow!("Recording already in progress"));
        }

        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        let (done_tx, done_rx) = mpsc::channel::<Result<()>>();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<String>>();

        let is_recording = Arc::clone(&self.is_recording);

        // Generate the output path upfront so we can return it immediately.
        let file_name = format!("recording_{}.wav", uuid::Uuid::new_v4());
        let file_path = std::env::temp_dir().join(&file_name);
        let file_path_str = file_path.to_string_lossy().to_string();
        let file_path_for_thread = file_path.clone();

        std::thread::spawn(move || {
            let host = cpal::default_host();
            let device = match host.default_input_device() {
                Some(d) => d,
                None => {
                    ready_tx
                        .send(Err(anyhow!("No input device available")))
                        .ok();
                    return;
                }
            };

            let config = match device.default_input_config() {
                Ok(c) => c,
                Err(e) => {
                    ready_tx
                        .send(Err(anyhow!("Failed to get input config: {}", e)))
                        .ok();
                    return;
                }
            };

            let channels = config.channels() as usize;
            let sample_rate = config.sample_rate().0;
            eprintln!(
                "[audio] device config: {} channels @ {} Hz, format {:?}",
                channels,
                sample_rate,
                config.sample_format()
            );

            // Collect mono f32 samples during recording; WAV is written after
            // stop so we can resample the whole buffer at once.
            let sample_buf: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
            let callback_err = |err| eprintln!("[audio] stream error: {}", err);

            let flag = Arc::clone(&is_recording);
            let buf = Arc::clone(&sample_buf);

            let stream_result = match config.sample_format() {
                cpal::SampleFormat::I16 => {
                    device.build_input_stream(
                        &config.into(),
                        move |data: &[i16], _: &cpal::InputCallbackInfo| {
                            if flag.load(Ordering::SeqCst) {
                                if let Ok(mut b) = buf.try_lock() {
                                    // Keep only first channel (mono downmix)
                                    for chunk in data.chunks(channels) {
                                        b.push(chunk[0] as f32 / 32768.0);
                                    }
                                }
                            }
                        },
                        callback_err,
                        None,
                    )
                }
                cpal::SampleFormat::F32 => device.build_input_stream(
                    &config.into(),
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        if flag.load(Ordering::SeqCst) {
                            if let Ok(mut b) = buf.try_lock() {
                                for chunk in data.chunks(channels) {
                                    b.push(chunk[0]);
                                }
                            }
                        }
                    },
                    callback_err,
                    None,
                ),
                fmt => {
                    ready_tx
                        .send(Err(anyhow!("Unsupported sample format: {:?}", fmt)))
                        .ok();
                    return;
                }
            };

            let stream = match stream_result {
                Ok(s) => s,
                Err(e) => {
                    ready_tx
                        .send(Err(anyhow!("Failed to build stream: {}", e)))
                        .ok();
                    return;
                }
            };

            if let Err(e) = stream.play() {
                ready_tx
                    .send(Err(anyhow!("Failed to start stream: {}", e)))
                    .ok();
                return;
            }

            is_recording.store(true, Ordering::SeqCst);
            ready_tx
                .send(Ok(file_path_for_thread.to_string_lossy().to_string()))
                .ok();

            stop_rx.recv().ok();
            is_recording.store(false, Ordering::SeqCst);
            drop(stream);

            // Resample entire buffer to 16 kHz and write WAV.
            let samples = std::mem::take(&mut *sample_buf.lock().unwrap());
            let resampled = resample_to_16k(&samples, sample_rate);

            let result = write_wav_16k(&file_path_for_thread, &resampled);
            done_tx.send(result).ok();
        });

        let file_path_str_from_thread = ready_rx
            .recv()
            .map_err(|_| anyhow!("Recording thread exited before starting"))??;

        *self.current_file_path.lock().unwrap() = Some(file_path_str_from_thread.clone());
        *self.stop_sender.lock().unwrap() = Some(stop_tx);
        *self.done_receiver.lock().unwrap() = Some(done_rx);

        Ok(file_path_str)
    }

    pub fn stop_recording(&self) -> Result<Option<String>> {
        if !self.is_recording.load(Ordering::SeqCst) {
            return Ok(None);
        }

        let file_path = self.current_file_path.lock().unwrap().take();

        if let Some(tx) = self.stop_sender.lock().unwrap().take() {
            tx.send(()).ok();
        }

        // Wait for resampling + WAV write to finish before giving path to caller.
        if let Some(rx) = self.done_receiver.lock().unwrap().take() {
            match rx.recv_timeout(std::time::Duration::from_secs(10)) {
                Ok(Ok(())) => {}
                Ok(Err(e)) => eprintln!("[audio] WAV write error: {}", e),
                Err(_) => eprintln!("[audio] warning: recording thread did not signal completion"),
            }
        }

        eprintln!("[audio] recording stopped, file: {:?}", file_path);
        Ok(file_path)
    }

    pub fn check_recording_status(&self) -> bool {
        self.is_recording.load(Ordering::SeqCst)
    }
}

impl Default for AudioRecorder {
    fn default() -> Self {
        Self::new()
    }
}

/// Linear interpolation resample to TARGET_SAMPLE_RATE.
/// For speech (content mostly below 4 kHz) this is sufficient quality.
fn resample_to_16k(samples: &[f32], from_rate: u32) -> Vec<f32> {
    if from_rate == TARGET_SAMPLE_RATE {
        return samples.to_vec();
    }
    let ratio = from_rate as f64 / TARGET_SAMPLE_RATE as f64;
    let out_len = (samples.len() as f64 / ratio) as usize;
    (0..out_len)
        .map(|i| {
            let pos = i as f64 * ratio;
            let idx = pos as usize;
            let frac = (pos - idx as f64) as f32;
            let s0 = samples.get(idx).copied().unwrap_or(0.0);
            let s1 = samples.get(idx + 1).copied().unwrap_or(s0);
            s0 + (s1 - s0) * frac
        })
        .collect()
}

fn write_wav_16k(path: &std::path::Path, samples: &[f32]) -> Result<()> {
    let spec = WavSpec {
        channels: 1,
        sample_rate: TARGET_SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: SampleFormat::Int,
    };
    let mut writer =
        WavWriter::create(path, spec).map_err(|e| anyhow!("Failed to create WAV: {}", e))?;
    for &s in samples {
        let sample = (s * 32767.0).clamp(-32768.0, 32767.0) as i16;
        writer
            .write_sample(sample)
            .map_err(|e| anyhow!("WAV write error: {}", e))?;
    }
    writer
        .finalize()
        .map_err(|e| anyhow!("WAV finalize error: {}", e))
}

pub fn list_input_devices() -> Result<Vec<AudioDevice>> {
    let host = cpal::default_host();
    let devices = host.input_devices()?;

    let default_device = host.default_input_device();
    let default_name = default_device
        .and_then(|d| d.name().ok())
        .unwrap_or_default();

    let mut result = Vec::new();
    for device in devices {
        if let Ok(name) = device.name() {
            let is_default = name == default_name;
            result.push(AudioDevice { name, is_default });
        }
    }

    if result.is_empty() {
        return Err(anyhow!("No input devices found"));
    }

    Ok(result)
}

pub fn test_microphone(device_name: Option<&str>) -> Result<bool> {
    let host = cpal::default_host();

    let device = if let Some(name) = device_name {
        match host
            .input_devices()?
            .find(|d| d.name().map(|n| n == name).unwrap_or(false))
        {
            Some(d) => d,
            None => return Err(anyhow!("Device '{}' not found", name)),
        }
    } else {
        match host.default_input_device() {
            Some(d) => d,
            None => return Err(anyhow!("No default input device")),
        }
    };

    let config = device
        .default_input_config()
        .map_err(|e| anyhow!("Failed to get input config: {}", e))?;

    let channels = config.channels() as usize;
    let sample_buf: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
    let is_recording = Arc::new(AtomicBool::new(true));
    let flag = Arc::clone(&is_recording);
    let buf = Arc::clone(&sample_buf);

    let stream = match config.sample_format() {
        cpal::SampleFormat::I16 => device.build_input_stream(
            &config.into(),
            move |data: &[i16], _: &cpal::InputCallbackInfo| {
                if flag.load(Ordering::SeqCst) {
                    if let Ok(mut b) = buf.try_lock() {
                        for chunk in data.chunks(channels) {
                            b.push(chunk[0] as f32 / 32768.0);
                        }
                    }
                }
            },
            |err| eprintln!("[mic-test] stream error: {}", err),
            None,
        ),
        cpal::SampleFormat::F32 => device.build_input_stream(
            &config.into(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                if flag.load(Ordering::SeqCst) {
                    if let Ok(mut b) = buf.try_lock() {
                        for chunk in data.chunks(channels) {
                            b.push(chunk[0]);
                        }
                    }
                }
            },
            |err| eprintln!("[mic-test] stream error: {}", err),
            None,
        ),
        fmt => return Err(anyhow!("Unsupported sample format: {:?}", fmt)),
    }
    .map_err(|e| anyhow!("Failed to build stream: {}", e))?;

    stream
        .play()
        .map_err(|e| anyhow!("Failed to start stream: {}", e))?;

    std::thread::sleep(Duration::from_secs(1));
    is_recording.store(false, Ordering::SeqCst);
    drop(stream);

    let lock_result = sample_buf.lock();
    if let Ok(buf) = lock_result {
        let samples = buf.len();
        if samples > 0 {
            let avg_amplitude: f32 = buf.iter().map(|s| s.abs()).sum::<f32>() / samples as f32;
            eprintln!(
                "[mic-test] captured {} samples, avg amplitude: {:.4}",
                samples, avg_amplitude
            );
            return Ok(avg_amplitude > 0.001);
        }
    }
    Ok(false)
}

pub fn check_microphone_status() -> Result<bool> {
    let host = cpal::default_host();

    let device = match host.default_input_device() {
        Some(d) => d,
        None => return Ok(false),
    };

    match device.default_input_config() {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}
