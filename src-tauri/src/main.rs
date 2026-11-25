#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod worker;

use serde::Deserialize;
use serde_json::{json, Value};
use std::{path::PathBuf, sync::Mutex};
use tauri::{Manager, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use worker::Worker;

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
enum Action {
    State,
    RunAll,
    RunNext,
    ExportRecipe,
    SaveWorkflow {
        name: String,
        steps: Vec<usize>,
        inputs: Value,
        outputs: Value,
    },
    ImportWorkflow,
    RunSavedWorkflow {
        id: String,
        name: String,
        sources: Value,
        numbers: Value,
    },
    MoveStep {
        step_id: usize,
        direction: i64,
    },
    MoveSource {
        source_id: Option<String>,
        destination: usize,
    },
    EditStep {
        step_id: usize,
        options: Value,
    },
    DeleteStep {
        step_id: usize,
    },
    ScaleColumn {
        runs: Value,
        factor: f64,
    },
    ApplyFormula {
        source_id: Option<String>,
        column: usize,
        expression: String,
    },
    AddScalar {
        name: String,
        value: f64,
        comment: Option<String>,
    },
    AddArray {
        name: String,
        values: Option<String>,
        expression: Option<String>,
        comment: Option<String>,
    },
    SystemFonts {
        refresh: bool,
    },
    ExportFonts,
    SetPreferences {
        style: Value,
        appearance: Value,
        run_automatically: Option<bool>,
    },
    SetGlobalStyle {
        style: Value,
    },
    WorksheetPage {
        offset: usize,
    },
    New,
    Sample,
    ImportData,
    Open,
    Correct {
        row: usize,
        column: usize,
        value: String,
    },
    InstallPlugin,
    RunPlugin {
        plugin_id: String,
        version: String,
        checksum: Option<String>,
        options: Value,
        figure_id: Option<usize>,
    },
    SelectSource {
        source_id: Option<String>,
    },
    SelectFigure {
        figure_id: usize,
    },
    EditItem {
        item: Value,
        name: Value,
    },
    ExecutePlugin {
        plugin_id: String,
        version: String,
        checksum: Option<String>,
        output: String,
        target_id: Option<usize>,
        runs: Vec<Value>,
    },
    Color {
        element: String,
        color: String,
        figure_id: usize,
    },
    FigureStyle {
        style: Value,
        figure_id: usize,
    },
    Save {
        notes: Option<String>,
    },
    SaveAs {
        name: String,
        notes: Option<String>,
    },
}

type Engine = Mutex<Option<Worker>>;

fn request_engine(window: &WebviewWindow, request: &Value) -> Result<Value, String> {
    let engine = window.state::<Engine>();
    let mut engine = engine.lock().map_err(|err| err.to_string())?;
    if engine.is_none() {
        let plugins = window
            .path()
            .app_data_dir()
            .map_err(|err| err.to_string())?
            .join("plugins");
        *engine = Some(Worker::start(&plugins)?);
    }
    engine.as_mut().unwrap().request(request)
}

#[tauri::command]
async fn workspace(
    window: WebviewWindow,
    request: Action,
    paged: Option<bool>,
    known_figures: Option<Value>,
) -> Result<Option<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(mut request) = prepare_request(&window, request)? else {
            return Ok(None);
        };
        request["_paged"] = json!(paged.unwrap_or(false));
        request["_known_figures"] = known_figures.unwrap_or(json!({}));
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
        };
        if let Some(request) = save_file(&window, "export", title, filter, &name, extension)? {
            let path = request["path"].as_str().ok_or("Invalid export path.")?;
            request_engine(
                &window,
                &json!({
                    "action": "export_rendered", "path": path, "svg": content, "scale": scale
                }),
            )?;
        }
        Ok(())
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn save_python_script(
    window: WebviewWindow,
    name: String,
    template: String,
    payload: Value,
    copy_raw_data: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(request) = save_file(
            &window,
            "export_script",
            "Export Python script",
            "Python",
            &name,
            "py",
        )? {
            request_engine(
                &window,
                &json!({
                    "action": "export_script",
                    "path": request["path"],
                    "template": template,
                    "payload": payload,
                    "copy_raw_data": copy_raw_data,
                }),
            )?;
        }
        Ok(())
    })
    .await
    .map_err(|err| err.to_string())?
}

fn prepare_request(window: &WebviewWindow, action: Action) -> Result<Option<Value>, String> {
    let request = match action {
        Action::WorksheetPage { offset } => json!({ "action": "worksheet_page", "offset": offset }),
        Action::SetPreferences {
            style,
            appearance,
            run_automatically,
        } => json!({
            "action": "set_preferences", "style": style, "appearance": appearance, "run_automatically": run_automatically
        }),
        Action::SetGlobalStyle { style } => json!({ "action": "set_global_style", "style": style }),
        Action::RunAll => json!({ "action": "run_all" }),
        Action::RunNext => json!({ "action": "run_next" }),
        Action::ExportRecipe => json!({ "action": "export_recipe" }),
        Action::SaveWorkflow {
            name,
            steps,
            inputs,
            outputs,
        } => {
            let Some(file) = save_file(
                window,
                "save_workflow",
                "Save as Workflow",
                "Nigiro Workflow",
                &name,
                "nigiro-workflow",
            )?
            else {
                return Ok(None);
            };
            json!({ "action": "save_workflow", "path": file["path"], "name": name, "steps": steps, "inputs": inputs, "outputs": outputs })
        }
        Action::ImportWorkflow => {
            return pick_file(
                window,
                "import_workflow",
                "Import Workflow",
                "Nigiro Workflow",
                "nigiro-workflow",
            );
        }
        Action::RunSavedWorkflow {
            id,
            name,
            sources,
            numbers,
        } => {
            json!({ "action": "run_saved_workflow", "id": id, "name": name, "sources": sources, "numbers": numbers })
        }
        Action::MoveStep { step_id, direction } => {
            json!({ "action": "move_step", "step_id": step_id, "direction": direction })
        }
        Action::MoveSource {
            source_id,
            destination,
        } => {
            json!({ "action": "move_source", "source_id": source_id, "destination": destination })
        }
        Action::EditStep { step_id, options } => {
            json!({ "action": "edit_step", "step_id": step_id, "options": options })
        }
        Action::DeleteStep { step_id } => json!({ "action": "delete_step", "step_id": step_id }),
        Action::ScaleColumn { runs, factor } => {
            json!({ "action": "scale_column", "runs": runs, "factor": factor })
        }
        Action::ApplyFormula {
            source_id,
            column,
            expression,
        } => {
            json!({ "action": "apply_formula", "source_id": source_id, "column": column, "expression": expression })
        }
        Action::AddScalar {
            name,
            value,
            comment,
        } => {
            json!({ "action": "add_scalar", "name": name, "value": value, "comment": comment })
        }
        Action::AddArray {
            name,
            values,
            expression,
            comment,
        } => {
            json!({ "action": "add_array", "name": name, "values": values, "expression": expression, "comment": comment })
        }
        Action::SystemFonts { refresh } => json!({ "action": "system_fonts", "refresh": refresh }),
        Action::ExportFonts => json!({ "action": "export_fonts" }),
        Action::State => json!({ "action": "state" }),
        Action::New => json!({ "action": "new" }),
        Action::Sample => json!({ "action": "sample" }),
        Action::Correct { row, column, value } => {
            json!({ "action": "correct", "row": row, "column": column, "value": value })
        }
        Action::RunPlugin {
            plugin_id,
            version,
            checksum,
            options,
            figure_id,
        } => json!({
            "action": "run_plugin", "plugin_id": plugin_id, "version": version,
            "checksum": checksum, "options": options, "figure_id": figure_id
        }),
        Action::SelectSource { source_id } => {
            json!({ "action": "select_source", "source_id": source_id })
        }
        Action::SelectFigure { figure_id } => {
            json!({ "action": "select_figure", "figure_id": figure_id })
        }
        Action::EditItem { item, name } => {
            json!({ "action": "edit_item", "item": item, "name": name })
        }
        Action::ExecutePlugin {
            plugin_id,
            version,
            checksum,
            output,
            target_id,
            runs,
        } => json!({
            "action": "execute_plugin", "plugin_id": plugin_id, "version": version, "checksum": checksum,
            "output": output, "target_id": target_id, "runs": runs
        }),
        Action::Color {
            element,
            color,
            figure_id,
        } => {
            json!({ "action": "color", "element": element, "color": color, "figure_id": figure_id })
        }
        Action::FigureStyle { style, figure_id } => {
            json!({ "action": "figure_style", "style": style, "figure_id": figure_id })
        }
        Action::Save { notes } => json!({ "action": "save", "notes": notes }),
        Action::ImportData => {
            let mut dialog = window
                .dialog()
                .file()
                .set_parent(window)
                .set_title("Import data")
                .add_filter("CSV", &["csv"]);
            if let Some(directory) = dialog_directory(window)? {
                dialog = dialog.set_directory(directory);
            }
            let paths = dialog.blocking_pick_files();
            return paths
                .map(|paths| {
                    let paths = paths
                        .into_iter()
                        .map(|path| path.into_path().map_err(|err| err.to_string()))
                        .collect::<Result<Vec<_>, _>>()?;
                    Ok(json!({ "action": "import_data", "paths": paths }))
                })
                .transpose();
        }
        Action::Open => return pick_file(window, "open", "Open project", "Nigiro", "nigiro"),
        Action::InstallPlugin => {
            let Some(request) = pick_file(
                window,
                "install_plugin",
                "Install Python plugin",
                "Python",
                "py",
            )?
            else {
                return Ok(None);
            };
            let path = request["path"].as_str().ok_or("Invalid plugin path.")?;
            let name = std::path::Path::new(path)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or(path);
            let message = format!(
                "Install {name}? A plugin runs Python code with your permissions. Install it only if you trust its author."
            );
            let approved = window
                .dialog()
                .message(message)
                .parent(window)
                .title("Trust Python plugin")
                .kind(MessageDialogKind::Warning)
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "Install".into(),
                    "Cancel".into(),
                ))
                .blocking_show();
            return Ok(approved.then_some(request));
        }
        Action::SaveAs { name, notes } => {
            return Ok(
                save_file(window, "save", "Save project", "Nigiro", &name, "nigiro")?.map(
                    |request| json!({ "action": "save", "path": request["path"], "notes": notes }),
                ),
            );
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
    let mut dialog = window
        .dialog()
        .file()
        .set_parent(window)
        .set_title(title)
        .add_filter(filter, &[extension]);
    if action == "open" {
        if let Some(directory) = dialog_directory(window)? {
            dialog = dialog.set_directory(directory);
        }
    }
    let path = dialog.blocking_pick_file();
    path.map(|path| {
        let path = path.into_path().map_err(|err| err.to_string())?;
        file_request(action, path)
    })
    .transpose()
}

fn dialog_directory(window: &WebviewWindow) -> Result<Option<PathBuf>, String> {
    let state = request_engine(window, &json!({ "action": "dialog_directory" }))?;
    Ok(state["directory"].as_str().map(PathBuf::from))
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
        .invoke_handler(tauri::generate_handler![
            workspace,
            save_rendered_figure,
            save_python_script
        ])
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
