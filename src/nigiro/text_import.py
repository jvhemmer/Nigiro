"""Detect and read tabular text without changing the source bytes."""

from __future__ import annotations

import codecs
import csv
import io
import re
from dataclasses import dataclass, replace
from itertools import islice


PREVIEW_ROWS = 20
PREVIEW_BYTES = 128 * 1024
DELIMITERS = ("\t", ",", ";", "|", "whitespace")
ENCODINGS = ("utf-8-sig", "utf-16", "utf-16-le", "utf-16-be", "cp1252", "latin-1")


@dataclass(frozen=True)
class TextImport:
    delimiter: str = ","
    encoding: str = "utf-8-sig"
    comment: str = ""
    skip_rows: int = 0
    header_row: int = 1
    ignore_rows: str = ""

    def __post_init__(self):
        if (not isinstance(self.delimiter, str)
            or (self.delimiter not in ("whitespace", "single") and
                (len(self.delimiter) != 1 or self.delimiter in '\r\n\0"'))):
            raise ValueError("Enter one delimiter character or select a preset.")
        if self.encoding not in ENCODINGS:
            raise ValueError("Choose a supported text encoding.")
        if not isinstance(self.comment, str) or any(char in self.comment for char in "\r\n\0"):
            raise ValueError("Enter a comment prefix on one line.")
        if any(type(value) is not int or value < 0 for value in (self.skip_rows, self.header_row)):
            raise ValueError("Use zero or a positive row number.")
        if self.header_row and self.header_row <= self.skip_rows:
            raise ValueError("Choose a header row after the rows to skip.")
        ignored_ranges(self.ignore_rows)


def ignored_ranges(value):
    if not isinstance(value, str):
        raise ValueError("Enter line numbers such as 2,5-8.")
    ranges = []
    for part in value.split(",") if value.strip() else ():
        match = re.fullmatch(r"([1-9][0-9]*)(?:\s*-\s*([1-9][0-9]*))?", part.strip())
        if not match:
            raise ValueError("Enter line numbers such as 2,5-8.")
        first, last = (int(number) if number else None for number in match.groups())
        last = last if last is not None else first
        if last < first:
            raise ValueError("Enter ignored line ranges in ascending order.")
        ranges.append((first, last))
    return ranges


def text_encoding(content):
    if content.startswith((codecs.BOM_UTF16_BE, codecs.BOM_UTF16_LE)):
        return "utf-16"
    try:
        codecs.getincrementaldecoder("utf-8-sig")().decode(content[:PREVIEW_BYTES], final=len(content) <= PREVIEW_BYTES)
    except UnicodeDecodeError:
        return "cp1252"
    return "utf-8-sig"


def decode_table(content, encoding, *, preview=False):
    if content.startswith((b"PK\x03\x04", b"\xd0\xcf\x11\xe0", b"%PDF-", b"\x1f\x8b", b"\x89PNG")):
        raise ValueError("This file is not a text table.")
    truncated = preview and len(content) > PREVIEW_BYTES
    try:
        text = codecs.getincrementaldecoder(encoding)().decode(
            content[:PREVIEW_BYTES] if truncated else content, final=not truncated,
        )
    except UnicodeError as error:
        raise ValueError("This file could not be read with the selected encoding.") from error
    if re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", text):
        raise ValueError("This file contains binary data or uses a different text encoding.")
    if truncated:
        boundary = max(text.rfind("\n"), text.rfind("\r"))
        text = text[:boundary + 1]
    return text


def table_records(text, settings):
    physical = 0
    continuing = False
    ranges = ignored_ranges(settings.ignore_rows)

    def lines(*, delimited=False):
        nonlocal physical, continuing
        start = max(settings.skip_rows + 1, settings.header_row)
        for physical, line in enumerate(io.StringIO(text, newline=""), 1):
            if physical < start:
                continue
            stripped = line.strip()
            excluded = not continuing and (not stripped or (settings.comment and stripped.startswith(settings.comment))
                                            or any(first <= physical <= last for first, last in ranges))
            if excluded and physical == settings.header_row:
                raise ValueError(f"Header row {physical} is blank or excluded.")
            if not excluded:
                continuing = delimited
                yield line

    if settings.delimiter == "whitespace":
        for line in lines():
            yield physical, tuple(line.split())
    elif settings.delimiter == "single":
        for line in lines():
            yield physical, (line.rstrip("\r\n"),)
    else:
        # Let the CSV reader handle quoted fields, including embedded newlines.
        reader = csv.reader(lines(delimited=True), delimiter=settings.delimiter, strict=True)
        try:
            for row in reader:
                continuing = False
                if row:
                    yield physical or reader.line_num, tuple(row)
        except csv.Error as error:
            raise ValueError(f"Check the quoted fields near line {physical or reader.line_num}. {error}") from error


def text_table(text, settings, *, limit=None):
    records = iter(table_records(text, settings))
    first = next(records, None)
    if first is None:
        if settings.header_row:
            raise ValueError("The selected header row is missing.")
        raise ValueError("The file needs at least one data row.")
    columns = first[1] if settings.header_row else tuple(f"Column {index + 1}" for index in range(len(first[1])))
    if not any(name.strip() for name in columns):
        raise ValueError("The header needs at least one column name.")

    def data_rows():
        if not settings.header_row:
            yield first
        yield from records

    rows = []
    for line, row in islice(data_rows(), limit):
        if len(row) != len(columns):
            raise ValueError(f"Line {line} has {len(row)} fields. Expected {len(columns)}.")
        rows.append(row)
    if not rows:
        raise ValueError("The file needs at least one data row.")
    return columns, tuple(rows)


def guess_import(content):
    settings = TextImport(encoding=text_encoding(content), header_row=0)
    try:
        sample = decode_table(content, settings.encoding, preview=True)
    except ValueError:
        return settings, False
    lines = list(islice(enumerate(io.StringIO(sample, newline=""), 1), 40))
    nonblank = [(index, line.strip()) for index, line in lines if line.strip()]
    if nonblank:
        prefix = next((prefix for prefix in ("#", "%", "//") if nonblank[0][1].startswith(prefix)), "")
        settings = replace(settings, comment=prefix)
    meaningful = [(index, line) for index, line in nonblank if not settings.comment or not line.startswith(settings.comment)]
    if not meaningful:
        return settings, False

    best = None
    for delimiter in DELIMITERS:
        candidate = replace(settings, delimiter=delimiter)
        try:
            records = list(islice(table_records(sample, candidate), 24))
        except ValueError:
            continue
        widths = [len(row) for _, row in records]
        if not widths or max(widths) < 2:
            continue
        consistent = len(set(widths)) == 1
        numeric_cells = sum(looks_numeric(cell) for _, row in records for cell in row)
        # Prefer complete numeric cells when two delimiters yield rectangular tables.
        rank = (consistent, delimiter != "whitespace", numeric_cells / sum(widths), max(widths))
        if best is None or rank > best[0]:
            best = rank, candidate, records

    if best is None:
        settings = replace(settings, delimiter="single")
        records = list(islice(table_records(sample, settings), 24))
        # Unfamiliar punctuation between fields is ambiguous. Show the options.
        confident = not any(re.search(r"[,:;|^~\t]", line) for _, line in meaningful)
    else:
        rank, settings, records = best
        confident = rank[0] and (settings.delimiter != "whitespace"
                                 or not any(re.search(r"[,;|]", line) for _, line in meaningful))
    first = records[0][1]

    if len(records) > 1 and not any(looks_numeric(value) for value in first):
        settings = replace(settings, header_row=meaningful[0][0])
    return settings, confident


def looks_numeric(value):
    try:
        float(value)
        return True
    except ValueError:
        return bool(re.fullmatch(r"[+-]?\d+,\d+(?:[eE][+-]?\d+)?", value.strip()))


def import_preview(content, settings, *, sample=True):
    text = decode_table(content, settings.encoding, preview=sample)
    raw = [line.rstrip("\r\n")[:400] for line in islice(io.StringIO(text, newline=""), PREVIEW_ROWS)]
    try:
        columns, rows = text_table(text, settings, limit=PREVIEW_ROWS)
    except ValueError as error:
        return {"columns": (), "rows": (), "raw": raw, "error": str(error)}
    return {"columns": columns[:100], "rows": [tuple(value[:400] for value in row[:100]) for row in rows],
            "raw": raw, "error": None}
