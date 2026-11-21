"""User preferences stored separately from project data."""

import json
import os
import re
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path

from .figure_style import FigureStyle


@dataclass(frozen=True)
class Appearance:
    theme: str = "system"
    accent: str = "#245883"

    def __post_init__(self) -> None:
        if self.theme not in ("system", "light", "dark"):
            raise ValueError("Choose System, Light, or Dark for the theme.")
        if not isinstance(self.accent, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", self.accent):
            raise ValueError("Choose a valid accent color.")


class Settings:
    def __init__(self, path: Path):
        self.path = path
        self.figure_style = FigureStyle()
        self.appearance = Appearance()
        self.run_automatically = True
        self.last_import_path: str | None = None
        self.last_project_path: str | None = None
        if path.exists():
            record = json.loads(path.read_text(encoding="utf-8"))
            self.figure_style = FigureStyle(**record.get("figure_style", record))
            if "figure_style" in record:
                self.appearance = Appearance(**record.get("appearance", {}))
                self.run_automatically = record.get("run_automatically", True)
                for key in ("last_import_path", "last_project_path"):
                    value = record.get(key)
                    if value is not None and not isinstance(value, str):
                        raise ValueError("Invalid saved file path.")
                    setattr(self, key, value)

    def save(self, style: FigureStyle) -> None:
        self.write(style)
        self.figure_style = style

    def save_preferences(self, style: FigureStyle, appearance: Appearance, run_automatically: bool | None = None) -> None:
        if run_automatically is not None and type(run_automatically) is not bool:
            raise ValueError("Choose whether to run steps automatically.")
        self.write(style, appearance, run_automatically)
        self.figure_style = style
        self.appearance = appearance
        if run_automatically is not None:
            self.run_automatically = run_automatically

    def remember(self, *, import_path: str | None = None, project_path: str | None = None) -> None:
        if import_path is not None:
            self.last_import_path = import_path
        if project_path is not None:
            self.last_project_path = project_path
        self.write(self.figure_style)

    def write(self, style: FigureStyle, appearance: Appearance | None = None, run_automatically: bool | None = None) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=self.path.parent, mode="w", encoding="utf-8", delete=False) as file:
            temporary = Path(file.name)
            try:
                json.dump({
                    "figure_style": asdict(style),
                    "appearance": asdict(appearance or self.appearance),
                    "run_automatically": self.run_automatically if run_automatically is None else run_automatically,
                    "last_import_path": self.last_import_path,
                    "last_project_path": self.last_project_path,
                }, file, indent=2, allow_nan=False)
            except BaseException:
                temporary.unlink(missing_ok=True)
                raise
        try:
            os.replace(temporary, self.path)
        finally:
            temporary.unlink(missing_ok=True)
