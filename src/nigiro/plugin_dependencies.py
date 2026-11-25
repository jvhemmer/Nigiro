"""Record the installed distributions that a plugin declares."""

from importlib.metadata import PackageNotFoundError, distribution

from packaging.requirements import InvalidRequirement, Requirement
from packaging.utils import canonicalize_name


def plugin_requirements(dependencies: object) -> list[Requirement]:
    if not isinstance(dependencies, list) or not all(isinstance(item, str) for item in dependencies):
        raise ValueError("List plugin dependencies as package requirements.")
    try:
        requirements = [Requirement(item) for item in dependencies]
    except InvalidRequirement as error:
        raise ValueError(f"Invalid plugin dependency. {error}") from error
    if any(requirement.url for requirement in requirements):
        raise ValueError("Use package names for plugin dependencies.")
    return requirements


def installed_requirements(dependencies: list[str]) -> dict[str, str]:
    pins = {}
    visited = set()

    def visit(requirement: Requirement) -> None:
        name = canonicalize_name(requirement.name)
        extras = frozenset(canonicalize_name(extra) for extra in requirement.extras)
        try:
            package = distribution(name)
        except PackageNotFoundError as error:
            raise ValueError(f"Install {requirement} in the selected Python environment.") from error
        version = package.version
        if not requirement.specifier.contains(version, prereleases=True):
            raise ValueError(f"The selected Python environment has {name} {version}. This plugin requires {requirement}.")
        pins[name] = version
        key = (name, extras)
        if key in visited:
            return
        visited.add(key)
        for text in package.requires or ():
            dependency = Requirement(text)
            if dependency.marker is None or any(
                dependency.marker.evaluate({"extra": extra}) for extra in ("", *extras)
            ):
                visit(dependency)

    for requirement in plugin_requirements(dependencies):
        if requirement.marker is None or requirement.marker.evaluate({"extra": ""}):
            visit(requirement)
    return dict(sorted(pins.items()))
