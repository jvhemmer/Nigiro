use crate::worker::Worker;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{path::BaseDirectory, Manager, WebviewWindow};

pub type Engine = Mutex<Option<Worker>>;

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum PythonRuntime {
    #[default]
    Bundled,
    Existing {
        executable: PathBuf,
    },
    Uv {
        version: String,
        executable: Option<PathBuf>,
    },
}

impl PythonRuntime {
    pub fn validate(&self) -> Result<(), String> {
        let executable = match self {
            Self::Bundled => return Ok(()),
            Self::Existing { executable } => Some(executable),
            Self::Uv {
                version,
                executable,
            } => {
                let valid = version.split_once('.').is_some_and(|(major, minor)| {
                    major == "3"
                        && minor.len() == 2
                        && minor.bytes().all(|b| b.is_ascii_digit())
                        && minor.parse::<u16>().is_ok_and(|minor| minor >= 10)
                });
                if !valid {
                    return Err("Enter a Python version such as 3.12.".into());
                }
                executable.as_ref()
            }
        };
        if executable.is_some_and(|path| !path.is_absolute() || !path.is_file()) {
            return Err("Enter the full path to an installed executable.".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default)]
pub struct DesktopPreferences {
    pub check_updates: bool,
    pub python: PythonRuntime,
}

impl Default for DesktopPreferences {
    fn default() -> Self {
        Self {
            check_updates: true,
            python: PythonRuntime::Bundled,
        }
    }
}

fn data_dir(window: &WebviewWindow) -> Result<PathBuf, String> {
    window
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())
}

pub fn preferences(window: &WebviewWindow) -> DesktopPreferences {
    data_dir(window)
        .ok()
        .and_then(|dir| fs::read(dir.join("desktop-preferences.json")).ok())
        .and_then(|data| serde_json::from_slice(&data).ok())
        .unwrap_or_default()
}

pub fn start(window: &WebviewWindow, runtime: &PythonRuntime) -> Result<Worker, String> {
    let plugins = data_dir(window)?.join("plugins");
    let resources = window
        .path()
        .resolve("runtime", BaseDirectory::Resource)
        .map_err(|error| error.to_string())?;
    let runtime_dir = if !resources.is_dir() && cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../build/engine/runtime")
    } else {
        resources
    };
    let home = window.path().home_dir().ok();
    Worker::start(&plugins, &runtime_dir, home.as_deref(), runtime)
}

fn info(window: &WebviewWindow) -> Result<Value, String> {
    let engine = window.state::<Engine>();
    let current = engine.lock().map_err(|error| error.to_string())?;
    let configured = preferences(window);
    Ok(json!({
        "version": window.package_info().version.to_string(),
        "preferences": configured,
        "active_python": current.as_ref().map(|worker| &worker.runtime),
        "python_fallback": current.as_ref().and_then(|worker| worker.fallback.as_deref()),
        "updates_unavailable": crate::updates::unavailable(window),
    }))
}

#[tauri::command]
pub fn desktop_info(window: WebviewWindow) -> Result<Value, String> {
    info(&window)
}

#[tauri::command]
pub async fn set_desktop_preferences(
    window: WebviewWindow,
    settings: DesktopPreferences,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if settings.python != preferences(&window).python
            && settings.python != PythonRuntime::Bundled
        {
            let mut worker = start(&window, &settings.python)?;
            worker.request(&json!({ "action": "state", "_paged": true }))?;
        }
        let directory = data_dir(&window)?;
        fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        let mut file =
            tempfile::NamedTempFile::new_in(&directory).map_err(|error| error.to_string())?;
        serde_json::to_writer(file.as_file_mut(), &settings).map_err(|error| error.to_string())?;
        file.persist(directory.join("desktop-preferences.json"))
            .map_err(|error| error.to_string())?;
        info(&window)
    })
    .await
    .map_err(|error| error.to_string())?
}
