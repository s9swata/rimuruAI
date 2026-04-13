use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, Mutex};
use std::process::{Child, ChildStdin, Stdio};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

// ─────────────────────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────────────────────

/// A live process slot stored in the registry.
pub(crate) struct ProcessSlot {
    stdin: ChildStdin,
    child: Child,
}

/// Payload emitted to the frontend for every line of output from a process.
#[derive(Clone, Serialize)]
pub struct ProcessOutputPayload {
    /// Unique process ID assigned at spawn time.
    pub id: String,
    /// The raw output line (from stdout or stderr).
    pub line: String,
    /// Whether the line came from stderr.
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

/// A thread-safe map of process-id → ProcessSlot.
/// Wrapped in an Arc so it can be shared across Tauri command threads.
pub type ProcessRegistry = Arc<Mutex<HashMap<String, ProcessSlot>>>;

/// Create a new, empty registry. Call this once in `lib.rs` and store it in
/// Tauri's managed state.
pub fn new_registry() -> ProcessRegistry {
    Arc::new(Mutex::new(HashMap::new()))
}

// ─────────────────────────────────────────────────────────────────────────────
//  spawn_process
// ─────────────────────────────────────────────────────────────────────────────

/// Spawns `program` with `args` as a long-running child process.
///
/// Stdout and stderr are captured line-by-line and forwarded to the frontend
/// via Tauri events:
///   - `"process-output"` → `ProcessOutputPayload`
///   - `"process-exit"`   → `ProcessExitPayload`
///
/// Returns the process UUID so the frontend can target future stdin writes.
#[tauri::command]
pub async fn spawn_process(
    program: String,
    args: Vec<String>,
    registry: tauri::State<'_, ProcessRegistry>,
    app: AppHandle,
) -> Result<String, String> {
    let id = uuid();
    log(&app, &format!("[spawn_process] id={} program={} args={:?}", id, program, args));

    let mut child = std::process::Command::new(&program)
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn '{}': {}", program, e))?;

    let stdin = child.stdin.take().ok_or("Could not capture stdin")?;
    let stdout = child.stdout.take().ok_or("Could not capture stdout")?;
    let stderr = child.stderr.take().ok_or("Could not capture stderr")?;

    // ── Stream stdout ────────────────────────────────────────────────────────
    {
        let id_clone = id.clone();
        let app_clone = app.clone();
        std::thread::spawn(move || {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(text) => {
                        let _ = app_clone.emit(
                            "process-output",
                            ProcessOutputPayload {
                                id: id_clone.clone(),
                                line: text,
                                is_stderr: false,
                            },
                        );
                    }
                    Err(_) => break,
                }
            }
        });
    }

    // ── Stream stderr ────────────────────────────────────────────────────────
    {
        let id_clone = id.clone();
        let app_clone = app.clone();
        std::thread::spawn(move || {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(stderr);
            for line in reader.lines() {
                match line {
                    Ok(text) => {
                        let _ = app_clone.emit(
                            "process-output",
                            ProcessOutputPayload {
                                id: id_clone.clone(),
                                line: text,
                                is_stderr: true,
                            },
                        );
                    }
                    Err(_) => break,
                }
            }
        });
    }

    // ── Watch for exit and emit process-exit event ───────────────────────────
    {
        let id_clone = id.clone();
        let app_clone = app.clone();
        let registry_clone = Arc::clone(&*registry);
        std::thread::spawn(move || {
            // We need a second handle to the child to wait on it. Since we
            // moved `child.stdin/stdout/stderr` out above, only the raw child
            // remains. We'll store it in the registry and wait from there.
            //
            // Grab a mutable ref via a second lock after the slot is inserted.
            // The slot is inserted below (after this thread spawns) so we park
            // briefly to let the main thread finish inserting.
            std::thread::sleep(std::time::Duration::from_millis(50));
            let code = {
                let mut map = registry_clone.lock().unwrap();
                if let Some(slot) = map.get_mut(&id_clone) {
                    slot.child.wait().ok().and_then(|s| s.code())
                } else {
                    None
                }
            };
            // Remove slot on exit – stdin dropped, resources freed.
            {
                let mut map = registry_clone.lock().unwrap();
                map.remove(&id_clone);
            }
            let _ = app_clone.emit(
                "process-exit",
                ProcessExitPayload { id: id_clone, code },
            );
        });
    }

    // ── Store slot in registry ───────────────────────────────────────────────
    {
        let mut map = registry.lock().map_err(|e| e.to_string())?;
        map.insert(id.clone(), ProcessSlot { stdin, child });
    }

    log(&app, &format!("[spawn_process] spawned id={}", id));
    Ok(id)
}

// ─────────────────────────────────────────────────────────────────────────────
//  write_to_process
// ─────────────────────────────────────────────────────────────────────────────

/// Writes `payload` (as raw bytes + newline) to the stdin of the process
/// identified by `id`. Used to send JSON-RPC messages to MCP servers.
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
    slot.stdin
        .write_all(bytes.as_bytes())
        .map_err(|e| format!("Failed to write to process stdin: {}", e))?;
    slot.stdin.flush().map_err(|e| e.to_string())?;

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
//  kill_process
// ─────────────────────────────────────────────────────────────────────────────

/// Forcefully terminates the process identified by `id` and removes it from
/// the registry. Safe to call even if the process has already exited.
#[tauri::command]
pub fn kill_process(
    id: String,
    registry: tauri::State<'_, ProcessRegistry>,
    app: AppHandle,
) -> Result<(), String> {
    log(&app, &format!("[kill_process] id={}", id));

    let mut map = registry.lock().map_err(|e| e.to_string())?;
    if let Some(mut slot) = map.remove(&id) {
        slot.child.kill().unwrap_or_default();
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
//  list_processes
// ─────────────────────────────────────────────────────────────────────────────

/// Returns a list of all currently-running managed process IDs.
#[tauri::command]
pub fn list_processes(
    registry: tauri::State<'_, ProcessRegistry>,
) -> Vec<String> {
    registry
        .lock()
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default()
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

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
    use std::io::Write as _;
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
    // Also suppress the unused AppHandle warning by touching it
    let _ = app;
}
