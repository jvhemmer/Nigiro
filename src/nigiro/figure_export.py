"""Write static files from a Plotly SVG."""

from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile, TemporaryDirectory

import typst


def write_figure(path: Path, svg: str, scale: int, font_directory: Path) -> None:
    format_name = path.suffix.lower().removeprefix(".")
    if format_name not in ("png", "pdf"):
        raise ValueError("Use .png or .pdf for the file extension.")
    if type(scale) is not int or scale not in range(1, 5):
        raise ValueError("Choose a resolution from 1× to 4×.")

    with TemporaryDirectory() as directory:
        root = Path(directory)
        (root / "figure.svg").write_text(svg, encoding="utf-8")
        document = root / "figure.typ"
        document.write_text(
            '#set page(width: auto, height: auto, margin: 0pt, fill: none)\n'
            '#set text(font: "DejaVu Sans")\n'
            '#image("figure.svg")\n',
            encoding="utf-8",
        )
        try:
            content = typst.compile(
                document,
                format=format_name,
                font_paths=[font_directory],
                ppi=96 * scale if format_name == "png" else None,
                pdf_tags=False,
                timestamp=datetime(1970, 1, 1, tzinfo=timezone.utc),
            )
        except typst.TypstError as error:
            raise ValueError(f"Could not export the figure. {error}") from error

    with NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
        pending = Path(temporary.name)
    try:
        pending.write_bytes(content)
        pending.replace(path)
    finally:
        pending.unlink(missing_ok=True)
