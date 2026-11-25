"""Freeze the Python worker for the host's Tauri target."""

import shutil
import subprocess
import sys
from pathlib import Path


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    rust_version = subprocess.check_output(["rustc", "-vV"], text=True)
    target = next(line.removeprefix("host: ") for line in rust_version.splitlines()
                  if line.startswith("host: "))
    build = root / "build" / "engine"
    build.mkdir(parents=True, exist_ok=True)
    runtime = build / "runtime"
    runtime_source = runtime / "nigiro"
    if runtime_source.exists():
        shutil.rmtree(runtime_source)
    shutil.copytree(root / "src" / "nigiro", runtime_source,
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    subprocess.run(
        ["uv", "export", "--locked", "--no-default-groups", "--no-emit-project", "--no-hashes",
         "--output-file", str(runtime / "requirements.txt"), "--quiet"],
        cwd=root,
        check=True,
    )
    if "--runtime-only" in sys.argv:
        return
    subprocess.run(
        [
            sys.executable, "-m", "PyInstaller",
            "--noconfirm",
            "--onefile",
            "--name", f"nigiro-engine-{target}",
            "--distpath", str(root / "src-tauri" / "binaries"),
            "--workpath", str(build),
            "--specpath", str(build),
            "--exclude-module", "PyQt6",
            "--exclude-module", "tkinter",
            "--add-data", f"{root / 'src' / 'nigiro' / 'fonts'}:nigiro/fonts",
            "--hidden-import", "matplotlib.backends.backend_svg",
            "--hidden-import", "matplotlib.backends.backend_pdf",
            str(root / "src" / "nigiro" / "desktop.py"),
        ],
        cwd=root,
        check=True,
    )


if __name__ == "__main__":
    main()
