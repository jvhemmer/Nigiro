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
    Plot {
        plot_type: String,
        x: usize,
        y: usize,
    },
    Color {
        element: String,
        color: String,
    },
    FigureStyle {
        style: Value,
    },
    Save,
    SaveAs {
        name: String,
    },
}

type Engine = Mutex<Option<Worker>>;

fn request_engine(window: &WebviewWindow, request: &Value) -> Result<Value, String> {
    let engine = window.state::<Engine>();
    let mut engine = engine.lock().map_err(|err| err.to_string())?;
    if engine.is_none() {
        *engine = Some(Worker::start()?);
    }
    engine.as_mut().unwrap().request(request)
}

#[tauri::command]
async fn workspace(window: WebviewWindow, request: Action) -> Result<Option<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(request) = prepare_request(&window, request)? else {
            return Ok(None);
        };
        request_engine(&window, &request).map(Some)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum RenderedFormat {
    Png,
    Pdf,
    Py,
}

#[tauri::command]
async fn save_rendered_figure(
    window: WebviewWindow,
    name: String,
    format: RenderedFormat,
    content: String,
    scale: u8,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (title, filter, extension) = match format {
            RenderedFormat::Png => ("Export figure", "PNG", "png"),
            RenderedFormat::Pdf => ("Export figure", "PDF", "pdf"),
            RenderedFormat::Py => ("Export Python script", "Python", "py"),
        };
        if let Some(request) = save_file(&window, "export", title, filter, &name, extension)? {
            let path = request["path"].as_str().ok_or("Invalid export path.")?;
            match format {
                RenderedFormat::Png | RenderedFormat::Pdf => {
                    request_engine(&window, &json!({
                        "action": "export_rendered", "path": path, "svg": content, "scale": scale
                    }))?;
                }
                RenderedFormat::Py => {
                    std::fs::write(path, content).map_err(|err| err.to_string())?;
                }
            }
        }
        Ok(())
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
        Action::Plot { plot_type, x, y } => {
            json!({ "action": "plot", "plot_type": plot_type, "x": x, "y": y })
        }
        Action::Color { element, color } => {
            json!({ "action": "color", "element": element, "color": color })
        }
        Action::FigureStyle { style } => json!({ "action": "figure_style", "style": style }),
        Action::Save => json!({ "action": "save" }),
        Action::ImportCsv => return pick_file(window, "import_csv", "Import CSV", "CSV", "csv"),
        Action::Open => return pick_file(window, "open", "Open project", "Nigiro", "nigiro"),
        Action::SaveAs { name } => {
            return save_file(window, "save", "Save project", "Nigiro", &name, "nigiro");
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
        .invoke_handler(tauri::generate_handler![workspace, save_rendered_figure])
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
