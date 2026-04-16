use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::process::{Child, Stdio};

use portable_pty::{CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

// ─────────────────────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────────────────────

/// A live process slot stored in the registry.
pub(crate) struct ProcessSlot {
    writer: Box<dyn Write + Send>,
    // PTY master kept alive for the duration of the process (dropping it closes the PTY).
    // None for pipe-mode processes.
    _master: Option<Box<dyn MasterPty + Send>>,
    // Raw pipe child — only set in pipe mode.
    _child: Option<Child>,
}

/// Payload emitted to the frontend for every line of output from a process.
#[derive(Clone, Serialize)]
pub struct ProcessOutputPayload {
    pub id: String,
    pub line: String,
    /// Always false with PTY (stdout+stderr merged into one stream).
    pub is_stderr: bool,
}

/// Payload emitted when a process exits.
#[derive(Clone, Serialize)]
pub struct ProcessExitPayload {
    pub id: String,
    pub code: Option<i32>,
}

// ─────────────────────────────────────────────────────────────────────────────
//  Global process registry
// ─────────────────────────────────────────────────────────────────────────────

pub type ProcessRegistry = Arc<Mutex<HashMap<String, ProcessSlot>>>;

pub fn new_registry() -> ProcessRegistry {
    Arc::new(Mutex::new(HashMap::new()))
}

// ─────────────────────────────────────────────────────────────────────────────
//  spawn_process  (PTY-backed)
// ─────────────────────────────────────────────────────────────────────────────

/// Spawns `sh -c <command>` inside a PTY so programs flush output immediately,
/// exactly as they would in a real terminal.
///
/// Events emitted to the frontend:
///   - `"process-output"` → `ProcessOutputPayload`
///   - `"process-exit"`   → `ProcessExitPayload`
#[tauri::command]
pub async fn spawn_process(
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
    use_pty: Option<bool>,
    registry: tauri::State<'_, ProcessRegistry>,
    app: AppHandle,
) -> Result<String, String> {
    let id = uuid();
    let working_dir = cwd
        .filter(|s| !s.is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("/")));
    let pty = use_pty.unwrap_or(true);

    log(&app, &format!(
        "[spawn_process] id={} program={} args={:?} cwd={:?} pty={}",
        id, program, args, working_dir, pty
    ));

    if pty {
        spawn_pty(id, program, args, working_dir, registry, app).await
    } else {
        spawn_pipes(id, program, args, working_dir, registry, app).await
    }
}

/// PTY-backed spawn — programs see a real terminal, output is line-buffered immediately.
async fn spawn_pty(
    id: String,
    program: String,
    args: Vec<String>,
    working_dir: std::path::PathBuf,
    registry: tauri::State<'_, ProcessRegistry>,
    app: AppHandle,
) -> Result<String, String> {
    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize { rows: 24, cols: 200, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let mut cmd = CommandBuilder::new(&program);
    for arg in &args { cmd.arg(arg); }
    cmd.cwd(&working_dir);
    cmd.env("TERM", "xterm-256color");
    cmd.env("HOME", dirs::home_dir().unwrap_or_default().to_string_lossy().as_ref());
    if let Ok(path) = std::env::var("PATH") { 
        log(&app, &format!("[spawn_process] PATH={}", path));
        cmd.env("PATH", path); 
    }

    let mut child = pair.slave.spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn '{}': {}", program, e))?;
    drop(pair.slave);

    let writer = pair.master.take_writer()
        .map_err(|e| format!("Failed to get PTY writer: {}", e))?;
    let reader = pair.master.try_clone_reader()
        .map_err(|e| format!("Failed to get PTY reader: {}", e))?;

    {
        let id_clone = id.clone();
        let app_clone = app.clone();
        std::thread::spawn(move || {
            use std::io::BufRead;
            for line in std::io::BufReader::new(reader).lines() {
                match line {
                    Ok(text) => { let _ = app_clone.emit("process-output", ProcessOutputPayload { id: id_clone.clone(), line: strip_ansi(&text), is_stderr: false }); }
                    Err(_) => break,
                }
            }
        });
    }

    {
        let id_clone = id.clone();
        let app_clone = app.clone();
        let registry_clone = Arc::clone(&*registry);
        std::thread::spawn(move || {
            let code = child.wait().ok().map(|s| s.exit_code() as i32);
            if let Ok(mut map) = registry_clone.lock() { map.remove(&id_clone); }
            let _ = app_clone.emit("process-exit", ProcessExitPayload { id: id_clone, code });
        });
    }

    {
        let mut map = registry.lock().map_err(|e| e.to_string())?;
        map.insert(id.clone(), ProcessSlot { writer, _master: Some(pair.master), _child: None });
    }

    log(&app, &format!("[spawn_process/pty] spawned id={}", id));
    Ok(id)
}

/// Pipe-backed spawn — stdout/stderr are separate streams, no terminal echo.
/// Used for MCP stdio servers and any process that must not have PTY interference.
async fn spawn_pipes(
    id: String,
    program: String,
    args: Vec<String>,
    working_dir: std::path::PathBuf,
    registry: tauri::State<'_, ProcessRegistry>,
    app: AppHandle,
) -> Result<String, String> {
    let mut child = std::process::Command::new(&program)
        .args(&args)
        .current_dir(&working_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn '{}': {}", program, e))?;

    let stdin: Box<dyn Write + Send> = Box::new(child.stdin.take().ok_or("Could not capture stdin")?);
    let stdout = child.stdout.take().ok_or("Could not capture stdout")?;
    let stderr = child.stderr.take().ok_or("Could not capture stderr")?;

    let stdout_done = Arc::new(AtomicBool::new(false));
    let stderr_done = Arc::new(AtomicBool::new(false));

    // Stream stdout
    {
        let id_clone = id.clone();
        let app_clone = app.clone();
        let stdout_done_clone = Arc::clone(&stdout_done);
        std::thread::spawn(move || {
            use std::io::BufRead;
            for line in std::io::BufReader::new(stdout).lines() {
                match line {
                    Ok(text) => { let _ = app_clone.emit("process-output", ProcessOutputPayload { id: id_clone.clone(), line: text, is_stderr: false }); }
                    Err(_) => break,
                }
            }
            stdout_done_clone.store(true, Ordering::Release);
        });
    }

    // Stream stderr
    {
        let id_clone = id.clone();
        let app_clone = app.clone();
        let stderr_done_clone = Arc::clone(&stderr_done);
        std::thread::spawn(move || {
            use std::io::BufRead;
            for line in std::io::BufReader::new(stderr).lines() {
                match line {
                    Ok(text) => { let _ = app_clone.emit("process-output", ProcessOutputPayload { id: id_clone.clone(), line: text, is_stderr: true }); }
                    Err(_) => break,
                }
            }
            stderr_done_clone.store(true, Ordering::Release);
        });
    }

    // Watch for exit
    {
        let id_clone = id.clone();
        let app_clone = app.clone();
        let registry_clone = Arc::clone(&*registry);
        std::thread::spawn(move || {
            loop {
                std::thread::sleep(std::time::Duration::from_millis(100));
                let result = {
                    let mut map = match registry_clone.lock() { Ok(m) => m, Err(_) => break };
                    if let Some(slot) = map.get_mut(&id_clone) {
                        if let Some(child) = slot._child.as_mut() {
                            match child.try_wait() {
                                Ok(Some(status)) => Some(status.code()),
                                Ok(None) => { continue; }
                                Err(_) => Some(None),
                            }
                        } else { break }
                    } else { break }
                };
                if let Some(code) = result {
                    // Wait for both reader threads to finish flushing output
                    // before emitting the exit event so the frontend receives
                    // all output lines before the exit signal.
                    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(500);
                    while (!stdout_done.load(Ordering::Acquire) || !stderr_done.load(Ordering::Acquire))
                        && std::time::Instant::now() < deadline
                    {
                        std::thread::sleep(std::time::Duration::from_millis(10));
                    }

                    if let Ok(mut map) = registry_clone.lock() { map.remove(&id_clone); }
                    let _ = app_clone.emit("process-exit", ProcessExitPayload { id: id_clone, code });
                    break;
                }
            }
        });
    }

    {
        let mut map = registry.lock().map_err(|e| e.to_string())?;
        map.insert(id.clone(), ProcessSlot { writer: stdin, _master: None, _child: Some(child) });
    }

    log(&app, &format!("[spawn_process/pipes] spawned id={}", id));
    Ok(id)
}

// ─────────────────────────────────────────────────────────────────────────────
//  write_to_process
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn write_to_process(
    id: String,
    payload: String,
    registry: tauri::State<'_, ProcessRegistry>,
    app: AppHandle,
) -> Result<(), String> {
    log(&app, &format!("[write_to_process] id={} payload_len={}", id, payload.len()));

    let mut map = registry.lock().map_err(|e| e.to_string())?;
    let slot = map
        .get_mut(&id)
        .ok_or_else(|| format!("No active process with id '{}'", id))?;

    let bytes = format!("{}\n", payload);
    slot.writer.write_all(bytes.as_bytes())
        .map_err(|e| format!("Failed to write to process: {}", e))?;
    slot.writer.flush().map_err(|e| e.to_string())?;

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
//  kill_process
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn kill_process(
    id: String,
    registry: tauri::State<'_, ProcessRegistry>,
    app: AppHandle,
) -> Result<(), String> {
    log(&app, &format!("[kill_process] id={}", id));

    let mut map = registry.lock().map_err(|e| e.to_string())?;
    map.remove(&id); // dropping MasterPty closes the PTY, killing the child
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
//  list_processes
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_processes(registry: tauri::State<'_, ProcessRegistry>) -> Vec<String> {
    registry
        .lock()
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default()
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Strip ANSI/VT escape sequences so the UI renders clean text.
fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            // ESC [ ... final-byte  (CSI sequences)
            if chars.peek() == Some(&'[') {
                chars.next();
                for c2 in chars.by_ref() {
                    if c2.is_ascii_alphabetic() { break; }
                }
            } else {
                // Other escape sequences: skip next char
                chars.next();
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn uuid() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    format!("proc_{:x}_{}", ts, seq)
}

fn log(app: &AppHandle, msg: &str) {
    use std::fs::OpenOptions;
    use dirs::data_dir;

    let path = data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("raphael")
        .join("raphael.log");

    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(
            f,
            "[{}] {}",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
            msg
        );
    }
    let _ = app;
}
