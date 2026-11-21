"""Tabular outputs from a saved plugin run."""

import math
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class SourceTable:
    name: str
    columns: tuple[str, ...]
    rows: tuple[tuple[str, ...], ...]

    @classmethod
    def from_record(cls, record: dict) -> "SourceTable":
        if not isinstance(record, dict):
            raise ValueError("Invalid source table.")
        name, columns, rows = record.get("name"), record.get("columns"), record.get("rows")
        if (
            not isinstance(name, str) or not name.strip()
            or not isinstance(columns, (list, tuple)) or not columns
            or not all(isinstance(column, str) for column in columns)
            or not isinstance(rows, (list, tuple))
        ):
            raise ValueError("A source table needs a name, columns, and rows.")
        cells = []
        for row in rows:
            if not isinstance(row, (list, tuple)) or len(row) != len(columns) or any(
                type(value) not in (str, int, float, bool, type(None))
                or (type(value) is float and not math.isfinite(value))
                for value in row
            ):
                raise ValueError("A source table row must match its columns.")
            cells.append(tuple("" if value is None else str(value) for value in row))
        return cls(name, tuple(columns), tuple(cells))


def output_tables(result: dict, analysis: bool) -> dict[str, SourceTable]:
    records = result.get("sources", {})
    if not isinstance(records, dict):
        raise ValueError("Plugin sources must be a dictionary of tables.")
    sources = {}
    for key, record in records.items():
        if not isinstance(key, str) or not re.fullmatch(r"[a-z][a-z0-9_-]*", key) or not isinstance(record, dict):
            raise ValueError("Use a stable key for each plugin source.")
        sources[key] = SourceTable.from_record(record)
    if not sources and analysis and result.get("summary"):
        sources["summary"] = SourceTable.from_record({
            "name": "Results", "columns": ["Metric", "Value"], "rows": list(result["summary"].items()),
        })
    return sources


def raw_source_id(index: int) -> str:
    return f"raw:{index}"


def source_origin(source_id: str) -> int | None:
    if isinstance(source_id, str) and re.fullmatch(r"raw:(0|[1-9][0-9]*)", source_id):
        return None
    if not isinstance(source_id, str) or not re.fullmatch(r"(0|[1-9][0-9]*):[a-z][a-z0-9_-]*", source_id):
        raise ValueError("Invalid derived source reference.")
    return int(source_id.split(":", 1)[0])
