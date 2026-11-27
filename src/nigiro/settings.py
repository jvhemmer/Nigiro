"""User preferences stored separately from project data."""

import json
import os
import re
import tempfile
from dataclasses import asdict, dataclass, replace
from pathlib import Path

from .figure_style import FigureStyle


def shared_figure_axes(style: FigureStyle) -> FigureStyle:
    separate = style.axes_separate if style.axes_separate is not None else style.x != style.y
    if separate:
        return replace(style, axes_separate=False, global_axis=style.x)
    return style


@dataclass(frozen=True)
class Appearance:
    theme: str = "system"
    accent: str = "#245883"

    def __post_init__(self) -> None:
        if self.theme not in ("system", "light", "dark"):
            raise ValueError("Choose System, Light, or Dark for the theme.")
        if not isinstance(self.accent, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", self.accent):
            raise ValueError("Choose a valid accent color.")


@dataclass(frozen=True)
class ProjectStorage:
    embed_files: bool = False
    embed_calculated_sources: bool = False
    embed_figures: bool = False

    def __post_init__(self) -> None:
        if not all(type(value) is bool for value in asdict(self).values()):
            raise ValueError("Choose whether to embed each type of project data.")

    def with_overrides(self, overrides: dict[str, bool]) -> "ProjectStorage":
        if not isinstance(overrides, dict) or not overrides.keys() <= vars(self).keys():
            raise ValueError("Choose valid project storage options.")
        return replace(self, **overrides)


class Settings:
    def __init__(self, path: Path):
        self.path = path
        self.figure_style = FigureStyle()
        self.appearance = Appearance()
        self.run_automatically = True
        self.project_storage = ProjectStorage()
        self.last_import_path: str | None = None
        self.last_project_path: str | None = None
        self.dialog_folders: dict[str, str] = {}
        self.recent_projects: list[str] = []
        self.recent_workspaces: list[str] = []
        if path.exists():
            record = json.loads(path.read_text(encoding="utf-8"))
            self.figure_style = shared_figure_axes(FigureStyle(**record.get("figure_style", record)))
            if "figure_style" in record:
                self.appearance = Appearance(**record.get("appearance", {}))
                self.run_automatically = record.get("run_automatically", True)
                self.project_storage = ProjectStorage(**record.get("project_storage", {}))
                for key in ("last_import_path", "last_project_path"):
                    value = record.get(key)
                    if value is not None and not isinstance(value, str):
                        raise ValueError("Invalid saved file path.")
                    setattr(self, key, value)
                folders = record.get("dialog_folders", {})
                if isinstance(folders, dict):
                    self.dialog_folders = {key: value for key, value in folders.items() if isinstance(value, str)}
                for key, default in (("recent_projects", [self.last_project_path] if self.last_project_path else []),
                                     ("recent_workspaces", [])):
                    recent = record.get(key, default)
                    if isinstance(recent, list):
                        setattr(self, key, list(dict.fromkeys(path for path in recent if isinstance(path, str)))[:10])

    def save(self, style: FigureStyle) -> None:
        style = shared_figure_axes(style)
        self.write(style)
        self.figure_style = style

    def save_preferences(self, style: FigureStyle, appearance: Appearance, run_automatically: bool | None = None,
                         project_storage: ProjectStorage | None = None) -> None:
        if run_automatically is not None and type(run_automatically) is not bool:
            raise ValueError("Choose whether to run steps automatically.")
        style = shared_figure_axes(style)
        self.write(style, appearance, run_automatically, project_storage)
        self.figure_style = style
        self.appearance = appearance
        if run_automatically is not None:
            self.run_automatically = run_automatically
        if project_storage is not None:
            self.project_storage = project_storage

    def remember(self, *, import_path: str | None = None, project_path: str | None = None,
                 recent_project_path: str | None = None,
                 workspace_path: str | None = None, dialog_folder: tuple[str, str] | None = None) -> None:
        if import_path is not None:
            self.last_import_path = import_path
        if project_path is not None:
            self.last_project_path = project_path
        if recent_project_path is not None:
            self.recent_projects = [recent_project_path, *(path for path in self.recent_projects if path != recent_project_path)][:10]
        if workspace_path is not None:
            self.recent_workspaces = [workspace_path, *(path for path in self.recent_workspaces if path != workspace_path)][:10]
        if dialog_folder is not None:
            action, directory = dialog_folder
            self.dialog_folders[action] = directory
        self.write(self.figure_style)

    def write(self, style: FigureStyle, appearance: Appearance | None = None, run_automatically: bool | None = None,
              project_storage: ProjectStorage | None = None) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=self.path.parent, mode="w", encoding="utf-8", delete=False) as file:
            temporary = Path(file.name)
            try:
                json.dump({
                    "figure_style": asdict(style),
                    "appearance": asdict(appearance or self.appearance),
                    "run_automatically": self.run_automatically if run_automatically is None else run_automatically,
                    "project_storage": asdict(project_storage or self.project_storage),
                    "last_import_path": self.last_import_path,
                    "last_project_path": self.last_project_path,
                    "dialog_folders": self.dialog_folders,
                    "recent_projects": self.recent_projects,
                    "recent_workspaces": self.recent_workspaces,
                }, file, indent=2, allow_nan=False)
            except BaseException:
                temporary.unlink(missing_ok=True)
                raise
        try:
            os.replace(temporary, self.path)
        finally:
            temporary.unlink(missing_ok=True)
