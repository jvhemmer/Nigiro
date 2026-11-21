"""Write a replay script and, optionally, separate copies of its inputs."""

from __future__ import annotations

import json
from base64 import b64decode
from pathlib import Path
from tempfile import NamedTemporaryFile

from .project import Source


PAYLOAD_MARKER = "\n# Nigiro replay payload\n"


def write_script(path: Path, template: str, payload: dict, sources: tuple[Source, ...], copy_raw_data: bool) -> None:
    head, marker, tail = template.partition(PAYLOAD_MARKER)
    if not marker:
        raise ValueError("The Python script template is missing its payload marker.")

    if not copy_raw_data:
        missing = [source.name for source in sources if not source.original_path]
        if missing:
            raise ValueError(
                f"No original CSV path is recorded for {', '.join(missing)}. Enable Copy raw CSV files beside the script."
            )

    copies = []
    folders = []
    pending = None

    def save_asset(directory: str, filename: str, content: bytes) -> str:
        folder = path.parent / directory
        try:
            folder.mkdir()
            folders.append(folder)
        except FileExistsError:
            pass
        stem, suffix = filename.split(".", 1)
        candidate = folder / filename
        number = 2
        while True:
            try:
                stream = candidate.open("xb")
                break
            except FileExistsError:
                candidate = folder / f"{stem}-{number}.{suffix}"
                number += 1
        copies.append(candidate)
        with stream:
            stream.write(content)
        return candidate.relative_to(path.parent).as_posix()

    try:
        inputs = []
        for index, source in enumerate(sources, start=1):
            reference = source.original_path
            if copy_raw_data:
                reference = save_asset("imports", f"source-{index:03d}.csv", source.content)
            inputs.append({
                "name": source.name, "path": reference, "encoding": source.encoding, "delimiter": source.delimiter,
            })

        record = {**payload, "recipe": {**payload["recipe"], "sources": inputs}}
        if "fonts" in record:
            fonts = []
            for index, font in enumerate(record["fonts"], start=1):
                metadata = {**font}
                extension = metadata["extension"]
                if extension not in (".ttf", ".otf"):
                    raise ValueError("Use a TrueType or OpenType font.")
                metadata["path"] = save_asset("fonts", f"font-{index:03d}{extension}", b64decode(metadata.pop("data")))
                fonts.append(metadata)
            record["fonts"] = fonts
        if "mathjax" in record:
            record["mathjax"] = save_asset("assets", "mathjax.js.gz", b64decode(record["mathjax"]))
        if "tick_formatter" in record:
            record["tick_formatter"] = save_asset("assets", "plot-ticks.js", record["tick_formatter"].encode("utf-8"))

        data = json.dumps(record, indent=2, allow_nan=False)
        with NamedTemporaryFile(dir=path.parent, mode="w", encoding="utf-8", delete=False) as temporary:
            pending = Path(temporary.name)
            temporary.write(f'{head}\nPAYLOAD = json.loads(r"""\n{data}\n""")\n{tail}')
        pending.replace(path)
    except BaseException:
        for copy in copies:
            copy.unlink(missing_ok=True)
        for folder in folders:
            try:
                folder.rmdir()
            except OSError:
                pass
        raise
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)
