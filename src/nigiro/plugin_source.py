"""Run a trusted single-file plugin."""

import sys
from types import ModuleType


def run_plugin_source(source, name, columns, rows, options):
    module = ModuleType("_nigiro_plugin")
    module.__file__ = name
    sys.modules[module.__name__] = module
    try:
        exec(compile(source, name, "exec"), vars(module))
        return module.run(columns, rows, options)
    finally:
        sys.modules.pop(module.__name__, None)
