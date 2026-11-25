"""Workspace files reference independently saved Nigiro projects."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, replace
from pathlib import Path
from tempfile import NamedTemporaryFile

WORKSPACE_SUFFIX = ".nigiro-workspace"


@dataclass(frozen=True)
class ProjectCollection:
    path: Path | None = None
    projects: tuple[Path, ...] = ()
    active: Path | None = None
    dirty: bool = True

    def select(self, path: Path) -> ProjectCollection:
        if path in self.projects:
            return replace(self, active=path)
        return replace(self, projects=(*self.projects, path), active=path, dirty=True)

    def save(self, path: Path) -> ProjectCollection:
        path = path.resolve()
        if path.suffix.lower() != WORKSPACE_SUFFIX:
            raise ValueError(f"Choose a file with the {WORKSPACE_SUFFIX} extension.")

        def reference(project: Path) -> str:
            try:
                return Path(os.path.relpath(project, path.parent)).as_posix()
            except ValueError:
                return project.as_posix()

        record = {
            "version": 1,
            "projects": [reference(project) for project in self.projects],
            "active": reference(self.active) if self.active else None,
        }
        with NamedTemporaryFile(dir=path.parent, mode="w", encoding="utf-8", delete=False) as file:
            pending = Path(file.name)
            try:
                json.dump(record, file, indent=2, ensure_ascii=False)
                file.write("\n")
                file.close()
                pending.replace(path)
            finally:
                pending.unlink(missing_ok=True)
        return replace(self, path=path, dirty=False)

    @classmethod
    def open(cls, path: Path) -> ProjectCollection:
        path = path.resolve()
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(data, dict) or type(data.get("version")) is not int or data["version"] != 1:
                raise ValueError("Unsupported Nigiro workspace format.")
            entries = data.get("projects")
            active_path = data.get("active")
            if not isinstance(entries, list) or (active_path is not None and not isinstance(active_path, str)):
                raise ValueError("Invalid workspace project list.")
            projects = tuple(dict.fromkeys(_project_path(path.parent, entry) for entry in entries))
            active = _project_path(path.parent, active_path) if active_path is not None else None
            if active is not None and active not in projects:
                raise ValueError("The active project is missing from the workspace list.")
        except (ValueError, RuntimeError) as error:
            raise ValueError(f"Could not read the workspace. {error}") from error
        return cls(path, projects, active, dirty=False)


def _project_path(directory: Path, entry: str) -> Path:
    if not isinstance(entry, str) or not entry.strip() or "\0" in entry:
        raise ValueError("Invalid project path.")
    project = directory / entry
    if project.suffix.lower() != ".nigiro":
        raise ValueError("Workspace projects must have a .nigiro extension.")
    return project.resolve()
