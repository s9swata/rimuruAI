use anyhow::{anyhow, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use hound::{SampleFormat, WavSpec, WavWriter};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

const VAD_THRESHOLD_DB: f32 = -45.0;
const SPEECH_REQUIRED_MS: u64 = 300;
const SILENCE_REQUIRED_MS: u64 = 500;
const SAMPLE_RATE: u32 = 16000;
const CHANNELS: u16 = 1;

#[derive(Clone, Debug)]
struct VadState {
    speech_detected: bool,
    silence_start_ms: Option<u64>,
    speech_start_ms: Option<u64>,
}

impl VadState {
    fn new() -> Self {
        Self {
            speech_detected: false,
            silence_start_ms: None,
            speech_start_ms: None,
        }
    }
}

pub struct AudioRecorder {
    is_recording: Arc<AtomicBool>,
    current_file_path: Arc<Mutex<Option<String>>>,
    vad_state: Arc<Mutex<VadState>>,
    recording_start_ms: Arc<Mutex<Option<u64>>>,
}

impl AudioRecorder {
    pub fn new() -> Self {
        Self {
            is_recording: Arc::new(AtomicBool::new(false)),
            current_file_path: Arc::new(Mutex::new(None)),
            vad_state: Arc::new(Mutex::new(VadState::new())),
            recording_start_ms: Arc::new(Mutex::new(None)),
        }
    }

    fn detect_voice(samples: &[i16]) -> bool {
        if samples.is_empty() {
            return false;
        }
        let sum: f32 = samples
            .iter()
            .map(|&s| {
                let v = s as f32 / 32768.0;
                v * v
            })
            .sum();
        let energy = (sum / samples.len() as f32).sqrt();
        let db = if energy > 0.0 {
            20.0 * energy.log10()
        } else {
            -100.0
        };
        db > VAD_THRESHOLD_DB
    }

    pub fn start_recording(&self) -> Result<String> {
        if self.is_recording.load(Ordering::SeqCst) {
            return Err(anyhow!("Recording already in progress"));
        }

        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| anyhow!("No input device available"))?;

        let config = device
            .default_input_config()
            .map_err(|e| anyhow!("Failed to get input config: {}", e))?;

        let spec = WavSpec {
            channels: CHANNELS,
            sample_rate: SAMPLE_RATE,
            bits_per_sample: 16,
            sample_format: SampleFormat::Int,
        };

        let temp_dir = std::env::temp_dir();
        let file_name = format!("recording_{}.wav", uuid::Uuid::new_v4());
        let file_path = temp_dir.join(&file_name);
        let file_path_str = file_path.to_string_lossy().to_string();

        let mut wav_writer = WavWriter::create(&file_path, spec)
            .map_err(|e| anyhow!("Failed to create WAV file: {}", e))?;

        let is_recording = Arc::clone(&self.is_recording);
        let vad_state = Arc::clone(&self.vad_state);
        let recording_start_ms = Arc::clone(&self.recording_start_ms);
        let writer_arc = Arc::new(Mutex::new(wav_writer));

        let callback_err = |err| eprintln!("Audio stream error: {}", err);

        match config.sample_format() {
            cpal::SampleFormat::I16 => {
                let wav = Arc::clone(&writer_arc);
                let stream = device.build_input_stream(
                    &config.into(),
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        let has_voice = AudioRecorder::detect_voice(data);

                        if let (Ok(mut vad), Ok(mut rec_start)) =
                            (vad_state.try_lock(), recording_start_ms.try_lock())
                        {
                            if has_voice && !vad.speech_detected {
                                if rec_start.is_none() {
                                    *rec_start = Some(0);
                                }
                                if vad.speech_start_ms.is_none() {
                                    vad.speech_start_ms = Some(0);
                                }
                            }

                            if has_voice {
                                vad.speech_detected = true;
                                vad.silence_start_ms = None;
                            } else if vad.speech_start_ms.is_some()
                                && vad.silence_start_ms.is_none()
                            {
                                vad.silence_start_ms = Some(0);
                            }

                            if vad.speech_detected {
                                if let Some(silence_start) = vad.silence_start_ms {
                                    if silence_start >= SILENCE_REQUIRED_MS {
                                        is_recording.store(false, Ordering::SeqCst);
                                    }
                                }
                            }
                        }

                        if is_recording.load(Ordering::SeqCst) {
                            if let Ok(mut guard) = wav.try_lock() {
                                for &sample in data {
                                    let _ = guard.write_sample(sample);
                                }
                            }
                        }
                    },
                    callback_err,
                    None,
                )?;
                stream
                    .play()
                    .map_err(|e| anyhow!("Failed to start stream: {}", e))?;
            }
            cpal::SampleFormat::F32 => {
                let wav = Arc::clone(&writer_arc);
                let stream = device.build_input_stream(
                    &config.into(),
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        let samples: Vec<i16> =
                            data.iter().map(|&s| (s * 32768.0) as i16).collect();
                        let has_voice = AudioRecorder::detect_voice(&samples);

                        if let (Ok(mut vad), Ok(mut rec_start)) =
                            (vad_state.try_lock(), recording_start_ms.try_lock())
                        {
                            if has_voice && !vad.speech_detected {
                                if rec_start.is_none() {
                                    *rec_start = Some(0);
                                }
                                if vad.speech_start_ms.is_none() {
                                    vad.speech_start_ms = Some(0);
                                }
                            }

                            if has_voice {
                                vad.speech_detected = true;
                                vad.silence_start_ms = None;
                            } else if vad.speech_start_ms.is_some()
                                && vad.silence_start_ms.is_none()
                            {
                                vad.silence_start_ms = Some(0);
                            }

                            if vad.speech_detected {
                                if let Some(silence_start) = vad.silence_start_ms {
                                    if silence_start >= SILENCE_REQUIRED_MS {
                                        is_recording.store(false, Ordering::SeqCst);
                                    }
                                }
                            }
                        }

                        if is_recording.load(Ordering::SeqCst) {
                            if let Ok(mut guard) = wav.try_lock() {
                                for &sample in &samples {
                                    let _ = guard.write_sample(sample);
                                }
                            }
                        }
                    },
                    callback_err,
                    None,
                )?;
                stream
                    .play()
                    .map_err(|e| anyhow!("Failed to start stream: {}", e))?;
            }
            _ => return Err(anyhow!("Unsupported sample format")),
        }

        self.is_recording.store(true, Ordering::SeqCst);
        *self.current_file_path.lock().unwrap() = Some(file_path_str.clone());

        Ok(file_path_str)
    }

    pub fn stop_recording(&self) -> Result<Option<String>> {
        if !self.is_recording.load(Ordering::SeqCst) {
            return Ok(None);
        }

        self.is_recording.store(false, Ordering::SeqCst);
        let file_path = self.current_file_path.lock().unwrap().take();

        *self.vad_state.lock().unwrap() = VadState::new();
        *self.recording_start_ms.lock().unwrap() = None;

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
