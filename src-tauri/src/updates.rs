use crate::desktop_config::Engine;
use serde::Serialize;
use std::{sync::Mutex, time::Duration};
use tauri::{Manager, WebviewWindow};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct AvailableUpdate(Mutex<Option<Update>>);

#[derive(Serialize)]
pub struct Release {
    version: String,
    notes: Option<String>,
}

pub fn unavailable(window: &WebviewWindow) -> Option<&'static str> {
    let config = window.config().plugins.0.get("updater");
    let configured = config
        .and_then(|value| value["pubkey"].as_str())
        .is_some_and(|key| !key.is_empty())
        && config
            .and_then(|value| value["endpoints"].as_array())
            .is_some_and(|urls| !urls.is_empty());
    if !configured {
        return Some("Updates are available in signed release builds.");
    }
    #[cfg(target_os = "linux")]
    if window.env().appimage.is_none() {
        return Some("Use your package manager to update this installation.");
    }
    None
}

#[tauri::command]
pub async fn check_for_update(window: WebviewWindow) -> Result<Option<Release>, String> {
    if let Some(reason) = unavailable(&window) {
        return Err(reason.into());
    }
    let app = window.app_handle().clone();
    let update = window
        .updater_builder()
        .timeout(Duration::from_secs(15))
        .on_before_exit(move || {
            if let Ok(mut engine) = app.state::<Engine>().lock() {
                engine.take();
            }
        })
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;
    let release = update.as_ref().map(|update| Release {
        version: update.version.clone(),
        notes: update.body.clone(),
    });
    *window
        .state::<AvailableUpdate>()
        .0
        .lock()
        .map_err(|error| error.to_string())? = update;
    Ok(release)
}

#[tauri::command]
pub async fn install_update(window: WebviewWindow, version: String) -> Result<(), String> {
    let mut update = window
        .state::<AvailableUpdate>()
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .as_ref()
        .filter(|update| update.version == version)
        .cloned()
        .ok_or("Check for updates before installing.")?;
    update.timeout = Some(Duration::from_secs(600));
    let package = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        update.install(package).map_err(|error| {
            #[cfg(target_os = "windows")]
            if window
                .state::<Engine>()
                .lock()
                .is_ok_and(|engine| engine.is_none())
            {
                return format!("{error} Close and reopen Nigiro to restart the analysis engine.");
            }
            error.to_string()
        })?;
        window.app_handle().restart();
    })
    .await
    .map_err(|error| error.to_string())?
}
