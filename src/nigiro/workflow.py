"""Recorded commands and stable references to their outputs."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from .project import Project, Source
from .source_tables import source_origin


@dataclass(frozen=True)
class Step:
    id: int
    label: str
    request: dict
    sources: tuple[Source, ...] = ()


@dataclass
class Workflow:
    base: Project
    steps: list[Step] = field(default_factory=list)
    completed: int = 0
    executed: set[int] = field(default_factory=set)
    bindings: dict[str, str | int | None] = field(default_factory=dict)
    needs_replay: bool = False
    error: str | None = None
    source_order: list[str | dict | None] = field(default_factory=list)
    next_step_id: int = 1
    source_groups: dict[str, dict] = field(default_factory=dict)
    source_memberships: dict[str, str | None] = field(default_factory=dict)

    def reference(self, kind: str, value):
        for output, bound in self.bindings.items():
            if output.split("/")[1] == kind and bound == value:
                return {"output": output}
        if kind == "source" and value is not None:
            origin = source_origin(value)
            if origin is not None:
                figure = self.reference("figure", origin)
                if isinstance(figure, dict):
                    return {**figure, "table": value.split(":", 1)[1]}
        return value

    def resolve(self, _kind: str, value):
        if not isinstance(value, dict):
            return value
        output = value["output"]
        if output not in self.bindings:
            producer = output.split("/", 1)[0]
            if not any(str(step.id) == producer for step in self.steps):
                raise ValueError("A required input came from a deleted step. Remove or replace this dependent step.")
            if any(str(step.id) == producer for step in self.steps[:self.completed]):
                raise ValueError("An earlier step no longer provides a required output. Restore that output or change this step's input.")
            raise ValueError("A required input comes from a later step. Move its producer before this step.")
        bound = self.bindings[output]
        return f"{bound}:{value['table']}" if "table" in value else bound

    def bind(self, step: Step, before: Project, after: Project) -> None:
        for kind, previous, current in (
            ("source", before.raw_sources, after.raw_sources),
            ("figure", before.figures, after.figures),
        ):
            for index, value in enumerate(key for key in current if key not in previous):
                self.bindings[f"{step.id}/{kind}/{index}"] = value

    def invalidate(self, position: int) -> None:
        if position < self.completed:
            self.completed = position
            self.needs_replay = True
        self.error = None


def map_references(request: dict, transform: Callable) -> dict:
    result = request.copy()
    for field, kind in (("source_id", "source"), ("figure_id", "figure"), ("target_id", "figure")):
        if field in result and (field == "source_id" or result[field] is not None):
            result[field] = transform(kind, result[field])
    if "figure_ids" in result:
        result["figure_ids"] = [transform("figure", value) for value in result["figure_ids"]]
    if "item" in result:
        item = result["item"]
        result["item"] = {**item, "id": transform(item["kind"], item["id"])}
    if "references" in result:
        result["references"] = {
            token: map_references(reference, transform)
            for token, reference in result["references"].items()
        }
    for field in ("runs", "steps"):
        if field in result:
            result[field] = [map_references(value, transform) for value in result[field]]
    return result
