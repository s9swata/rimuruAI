use std::process::Command;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

pub struct InjectorState {
    original_clipboard: Arc<Mutex<Option<String>>>,
}

impl Default for InjectorState {
    fn default() -> Self {
        Self {
            original_clipboard: Arc::new(Mutex::new(None)),
        }
    }
}

#[tauri::command]
pub async fn inject_text(app: AppHandle, text: String) -> Result<(), String> {
    let state = app.state::<InjectorState>();
    
    let original = get_clipboard_content(&app).await;
    {
        let mut guard = state.original_clipboard.lock().await;
        *guard = original;
    }
    
    set_clipboard_content(&app, &text).await.map_err(|e| e.to_string())?;
    
    tokio::time::sleep(Duration::from_millis(50)).await;
    
    simulate_paste().map_err(|e| e.to_string())?;
    
    let state_clone = state.original_clipboard.clone();
    let app_clone = app.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if let Some(original_text) = state_clone.lock().await.take() {
            let _ = set_clipboard_content(&app_clone, &original_text).await;
        }
    });
    
    Ok(())
}

async fn get_clipboard_content(app: &AppHandle) -> Option<String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard().read_text().ok()
}

async fn set_clipboard_content(app: &AppHandle, text: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard().write_text(text)?;
    Ok(())
}

fn simulate_paste() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        simulate_paste_macos()
    }
    #[cfg(target_os = "windows")]
    {
        simulate_paste_windows()
    }
    #[cfg(target_os = "linux")]
    {
        simulate_paste_linux()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Err("Unsupported platform".into())
    }
}

#[cfg(target_os = "macos")]
fn simulate_paste_macos() -> Result<(), String> {
    let output = Command::new("osascript")
        .args(["-e", "tell application \"System Events\" to keystroke \"v\" using command down"])
        .output()
        .map_err(|e| format!("Failed to execute AppleScript: {}", e))?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("AppleScript failed: {}", stderr));
    }
    
    Ok(())
}

#[cfg(target_os = "windows")]
fn simulate_paste_windows() -> Result<(), String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
        KEYEVENTF_KEYUP, VK_CONTROL, VK_V,
    };
    
    let inputs = [
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VK_CONTROL,
                    wScan: 0,
                    dwFlags: KEYBD_EVENT_FLAGS(0),
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VK_V,
                    wScan: 0,
                    dwFlags: KEYBD_EVENT_FLAGS(0),
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VK_V,
                    wScan: 0,
                    dwFlags: KEYBD_EVENT_FLAGS(KEYEVENTF_KEYUP.0),
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VK_CONTROL,
                    wScan: 0,
                    dwFlags: KEYBD_EVENT_FLAGS(KEYEVENTF_KEYUP.0),
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
    ];
    
    unsafe {
        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }
    
    Ok(())
}

#[cfg(target_os = "linux")]
fn simulate_paste_linux() -> Result<(), String> {
    let output = Command::new("xdotool")
        .arg("key")
        .arg("ctrl+v")
        .output()
        .map_err(|e| format!("Failed to execute xdotool: {}", e))?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("xdotool failed: {}", stderr));
    }
    
    Ok(())
}

#[tauri::command]
pub fn check_accessibility_permissions() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        check_accessibility_macos()
    }
    #[cfg(target_os = "windows")]
    {
        check_accessibility_windows()
    }
    #[cfg(target_os = "linux")]
    {
        check_accessibility_linux()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Ok(false)
    }
}

#[cfg(target_os = "macos")]
fn check_accessibility_macos() -> Result<bool, String> {
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
    }
    Ok(unsafe { AXIsProcessTrusted() })
}

#[cfg(target_os = "windows")]
fn check_accessibility_windows() -> Result<bool, String> {
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::Foundation::HANDLE;
    
    unsafe {
        let explorer: HANDLE = OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION,
            false,
            0xFFFF,
        ).unwrap_or(HANDLE::default());
        
        if explorer.is_invalid() {
            Ok(false)
        } else {
            let _ = windows::Win32::System::Threading::CloseHandle(explorer);
            Ok(true)
        }
    }
}

#[cfg(target_os = "linux")]
fn check_accessibility_linux() -> Result<bool, String> {
    let output = Command::new("xdotool")
        .arg("--version")
        .output();
    
    match output {
        Ok(o) => Ok(o.status.success()),
        Err(_) => Ok(false),
    }
}
