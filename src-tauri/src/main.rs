#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod worker;

use serde::Deserialize;
use serde_json::{json, Value};
use std::{path::PathBuf, sync::Mutex};
use tauri::{Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use worker::Worker;

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
enum Action {
    State,
    Sample,
    ImportCsv,
    Open,
    Correct {
        row: usize,
        column: usize,
        value: String,
    },
    Fit {
        x: usize,
        y: usize,
    },
    Color {
        element: String,
        color: String,
    },
    Save,
    SaveAs {
        name: String,
    },
    Export {
        name: String,
        format: FigureFormat,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum FigureFormat {
    Svg,
    Pdf,
}

type Engine = Mutex<Option<Worker>>;

#[tauri::command]
async fn workspace(window: WebviewWindow, request: Action) -> Result<Option<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(request) = prepare_request(&window, request)? else {
            return Ok(None);
        };
        let engine = window.state::<Engine>();
        let mut engine = engine.lock().map_err(|err| err.to_string())?;
        if engine.is_none() {
            *engine = Some(Worker::start()?);
        }
        engine.as_mut().unwrap().request(&request).map(Some)
    })
    .await
    .map_err(|err| err.to_string())?
}

fn prepare_request(window: &WebviewWindow, action: Action) -> Result<Option<Value>, String> {
    let request = match action {
        Action::State => json!({ "action": "state" }),
        Action::Sample => json!({ "action": "sample" }),
        Action::Correct { row, column, value } => {
            json!({ "action": "correct", "row": row, "column": column, "value": value })
        }
        Action::Fit { x, y } => json!({ "action": "fit", "x": x, "y": y }),
        Action::Color { element, color } => {
            json!({ "action": "color", "element": element, "color": color })
        }
        Action::Save => json!({ "action": "save" }),
        Action::ImportCsv => return pick_file(window, "import_csv", "Import CSV", "CSV", "csv"),
        Action::Open => return pick_file(window, "open", "Open project", "Nigiro", "nigiro"),
        Action::SaveAs { name } => {
            return save_file(window, "save", "Save project", "Nigiro", &name, "nigiro");
        }
        Action::Export { name, format } => {
            let (filter, extension) = match format {
                FigureFormat::Svg => ("SVG", "svg"),
                FigureFormat::Pdf => ("PDF", "pdf"),
            };
            return save_file(window, "export", "Export figure", filter, &name, extension);
        }
    };
    Ok(Some(request))
}

fn pick_file(
    window: &WebviewWindow,
    action: &str,
    title: &str,
    filter: &str,
    extension: &str,
) -> Result<Option<Value>, String> {
    let path = window
        .dialog()
        .file()
        .set_parent(window)
        .set_title(title)
        .add_filter(filter, &[extension])
        .blocking_pick_file();
    path.map(|path| {
        let path = path.into_path().map_err(|err| err.to_string())?;
        file_request(action, path)
    })
    .transpose()
}

fn save_file(
    window: &WebviewWindow,
    action: &str,
    title: &str,
    filter: &str,
    name: &str,
    extension: &str,
) -> Result<Option<Value>, String> {
    let path = window
        .dialog()
        .file()
        .set_parent(window)
        .set_title(title)
        .add_filter(filter, &[extension])
        .set_file_name(format!("{name}.{extension}"))
        .blocking_save_file();
    path.map(|path| {
        let mut path = path.into_path().map_err(|err| err.to_string())?;
        if path.extension().is_none() {
            path.set_extension(extension);
            if path.exists() {
                return Err(format!(
                    "Choose the full file name with the .{extension} extension."
                ));
            }
        }
        if !path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case(extension))
        {
            return Err(format!(
                "Choose a file name with the .{extension} extension."
            ));
        }
        file_request(action, path)
    })
    .transpose()
}

fn file_request(action: &str, path: PathBuf) -> Result<Value, String> {
    let path = path
        .to_str()
        .ok_or("The file name must use valid Unicode.")?;
    Ok(json!({ "action": action, "path": path }))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Engine::default())
        .invoke_handler(tauri::generate_handler![workspace])
        .build(tauri::generate_context!())
        .expect("Could not start Nigiro.")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                if let Ok(mut engine) = app.state::<Engine>().lock() {
                    engine.take();
                }
            }
        });
}
