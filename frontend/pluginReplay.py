import json
from contextlib import redirect_stdout


if __name__ == "__main__":
    source, name, columns, rows, options, *extra = json.load(sys.stdin)
    if extra:
        inputs, = extra
        extra = [{key: {**input, "columns": tuple(input["columns"]), "rows": tuple(map(tuple, input["rows"]))}
                  for key, input in inputs.items()}]
    with redirect_stdout(sys.stderr):
        result = run_plugin_source(source, name, tuple(columns), tuple(map(tuple, rows)), options, *extra)
    json.dump(result, sys.stdout, allow_nan=False)
