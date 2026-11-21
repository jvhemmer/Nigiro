"""User preferences stored separately from project data."""

import json
import os
import tempfile
from dataclasses import asdict
from pathlib import Path

from .figure_style import FigureStyle


class Settings:
    def __init__(self, path: Path):
        self.path = path
        self.figure_style = FigureStyle()
        if path.exists():
            self.figure_style = FigureStyle(**json.loads(path.read_text(encoding="utf-8")))

    def save(self, style: FigureStyle) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=self.path.parent, mode="w", encoding="utf-8", delete=False) as file:
            temporary = Path(file.name)
            try:
                json.dump(asdict(style), file, indent=2, allow_nan=False)
            except BaseException:
                temporary.unlink(missing_ok=True)
                raise
        try:
            os.replace(temporary, self.path)
        finally:
            temporary.unlink(missing_ok=True)
        self.figure_style = style
