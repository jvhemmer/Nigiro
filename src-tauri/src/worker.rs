use crate::desktop_config::PythonRuntime;
use serde::Deserialize;
use serde_json::Value;
use std::{
    fs::File,
    io::{BufRead, BufReader, Read, Seek, SeekFrom, Write},
    path::Path,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
};

pub struct Worker {
    pub runtime: PythonRuntime,
    pub fallback: Option<String>,
    child: Child,
    input: Option<ChildStdin>,
    output: BufReader<ChildStdout>,
    diagnostics: Option<File>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Reply {
    Success { state: Value },
    Failure { error: String },
}

impl Worker {
    pub fn start(
        plugin_dir: &Path,
        resources: &Path,
        home: Option<&Path>,
        runtime: &PythonRuntime,
    ) -> Result<Self, String> {
        runtime.validate()?;
        let mut command = match runtime {
            PythonRuntime::Bundled => {
                let path = std::env::current_exe()
                    .map_err(|err| err.to_string())?
                    .with_file_name(format!("nigiro-engine{}", std::env::consts::EXE_SUFFIX));
                Command::new(path)
            }
            PythonRuntime::Existing { executable } => Command::new(executable),
            PythonRuntime::Uv {
                version,
                executable,
            } => {
                let name = format!("uv{}", std::env::consts::EXE_SUFFIX);
                let installed = home
                    .map(|dir| dir.join(".local").join("bin").join(&name))
                    .filter(|path| path.is_file());
                let path = executable
                    .clone()
                    .or(installed)
                    .unwrap_or_else(|| name.into());
                let mut uv = Command::new(path);
                uv.args([
                    "--no-config",
                    "run",
                    "--no-project",
                    "--isolated",
                    "--managed-python",
                    "--python",
                    version,
                    "--with-requirements",
                ])
                .arg(resources.join("requirements.txt"))
                .args(["--", "python"]);
                uv
            }
        };
        let diagnostics = if *runtime != PythonRuntime::Bundled {
            if !resources.join("nigiro").join("desktop.py").is_file() {
                return Err("The Python engine source is missing from this build.".into());
            }
            command.args(["-I", "-c", concat!(
                "import sys; ",
                "assert sys.version_info >= (3, 10), 'Nigiro needs Python 3.10 or newer'; ",
                "sys.path.insert(0, sys.argv[1]); import typst; from nigiro.desktop import main; main()",
            )]).arg(resources);
            let log = tempfile::tempfile().map_err(|error| error.to_string())?;
            command.stderr(log.try_clone().map_err(|error| error.to_string())?);
            Some(log)
        } else {
            None
        };
        command.env("NIGIRO_PLUGIN_DIR", plugin_dir);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .map_err(|err| format!("Could not start the analysis engine. {err}"))?;
        let input = child.stdin.take().expect("Worker stdin is piped.");
        let output = child.stdout.take().expect("Worker stdout is piped.");
        Ok(Self {
            runtime: runtime.clone(),
            fallback: None,
            child,
            input: Some(input),
            output: BufReader::new(output),
            diagnostics,
        })
    }

    pub fn request(&mut self, request: &Value) -> Result<Value, String> {
        let input = self.input.as_mut().expect("Worker stdin is open.");
        let mut line = serde_json::to_vec(request).map_err(|err| err.to_string())?;
        line.push(b'\n');
        input
            .write_all(&line)
            .and_then(|_| input.flush())
            .map_err(|err| format!("Could not send a request to the analysis engine. {err}"))?;

        let mut reply = String::new();
        self.output
            .read_line(&mut reply)
            .map_err(|err| format!("Could not read the analysis engine response. {err}"))?;
        if reply.is_empty() {
            if let Some(log) = &mut self.diagnostics {
                let size = log.metadata().map_or(0, |info| info.len());
                let mut tail = Vec::new();
                if log.seek(SeekFrom::Start(size.saturating_sub(2048))).is_ok()
                    && log.take(2048).read_to_end(&mut tail).is_ok()
                    && !tail.is_empty()
                {
                    return Err(format!(
                        "The Python engine stopped. {}",
                        String::from_utf8_lossy(&tail).trim()
                    ));
                }
            }
            return Err("The analysis engine stopped. Close and reopen Nigiro.".into());
        }
        match serde_json::from_str(&reply) {
            Ok(Reply::Success { state }) => Ok(state),
            Ok(Reply::Failure { error }) => Err(error),
            Err(err) => Err(format!(
                "The analysis engine returned an invalid response. {err}"
            )),
        }
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        // Close stdin so Python can exit and PyInstaller can remove its temporary files.
        self.input.take();
        let _ = self.child.wait();
    }
}
