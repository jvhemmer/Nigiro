import json
from contextlib import redirect_stdout


if __name__ == "__main__":
    source, name, columns, rows, options = json.load(sys.stdin)
    with redirect_stdout(sys.stderr):
        result = run_plugin_source(source, name, columns, rows, options)
    json.dump(result, sys.stdout, allow_nan=False)
