use serde::Deserialize;
use serde_json::Value;
use std::{
    io::{BufRead, BufReader, Write},
    path::Path,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
};

pub struct Worker {
    child: Child,
    input: Option<ChildStdin>,
    output: BufReader<ChildStdout>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Reply {
    Success { state: Value },
    Failure { error: String },
}

impl Worker {
    pub fn start(plugin_dir: &Path) -> Result<Self, String> {
        let path = std::env::current_exe()
            .map_err(|err| err.to_string())?
            .with_file_name(format!("nigiro-engine{}", std::env::consts::EXE_SUFFIX));
        let mut command = Command::new(path);
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
            child,
            input: Some(input),
            output: BufReader::new(output),
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
