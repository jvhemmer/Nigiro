"""Evaluate a numeric expression over a target worksheet and referenced columns."""

from __future__ import annotations

import ast
import json
import math
import re


COLUMN_FORMULA_PLUGIN = "nigiro.column_formula"

# Quotes allow source and column names with spaces, punctuation, or units.
REFERENCE_NAME = r'"(?:[^"\\]|\\.)*"|[^\W\d][\w.]*'
REFERENCE = re.compile(rf'[$#](?P<source>{REFERENCE_NAME})(?::(?P<column>{REFERENCE_NAME}|[1-9][0-9]*))?')
FORMULA_FUNCTIONS = {
    "abs": abs, "min": min, "max": max, "sqrt": math.sqrt, "exp": math.exp,
    "log": math.log, "log10": math.log10, "sin": math.sin, "cos": math.cos, "tan": math.tan,
}
FORMULA_SYNTAX = (
    ast.Expression, ast.BinOp, ast.UnaryOp, ast.Call, ast.Name, ast.Load, ast.Constant,
    ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow, ast.Mod, ast.UAdd, ast.USub,
)


def parse_formula(expression):
    if not isinstance(expression, str) or not expression.strip() or len(expression) > 4096:
        raise ValueError("Enter a formula of 1 to 4096 characters.")
    references = {}

    def variable(match):
        token = match[0]
        if token not in references:
            source, column = match.groups()
            source = json.loads(source) if source.startswith('"') else source
            if column is not None:
                column = json.loads(column) if column.startswith('"') else int(column) if column.isdecimal() else column
            references[token] = (f"_input{len(references)}", source, column)
        return references[token][0]

    try:
        rewritten = REFERENCE.sub(variable, expression).strip().replace("^", "**")
        if "$" in rewritten or "#" in rewritten:
            raise ValueError("Use $Source:Column or a quoted source and column name.")
        tree = ast.parse(rewritten, mode="eval")
    except (SyntaxError, RecursionError) as error:
        raise ValueError("Enter a valid arithmetic formula.") from error

    variables = {"value", *(variable for variable, _, _ in references.values())}
    nodes = list(ast.walk(tree))
    for node in nodes:
        if not isinstance(node, FORMULA_SYNTAX):
            raise ValueError("Use arithmetic, source references, and supported math functions.")
        if isinstance(node, ast.Name) and node.id not in variables and node.id not in FORMULA_FUNCTIONS:
            raise ValueError(f"Unknown name {node.id}. Use value or a source reference.")
        if isinstance(node, ast.Call) and (
            not isinstance(node.func, ast.Name) or node.func.id not in FORMULA_FUNCTIONS
            or node.keywords or not node.args
        ):
            raise ValueError("Call a supported math function with numeric arguments.")
        if isinstance(node, ast.Constant):
            if type(node.value) not in (int, float):
                raise ValueError("Use numeric constants in the formula.")
            try:
                node.value = float(node.value)
            except OverflowError as error:
                raise ValueError("Use finite numeric constants.") from error
            if not math.isfinite(node.value):
                raise ValueError("Use finite numeric constants.")
    return compile(tree, "<column formula>", "eval"), references


def formula_values(rows, column, label):
    values = []
    for index, row in enumerate(rows, start=1):
        cell = row[column]
        if not cell.strip():
            values.append(None)
            continue
        try:
            value = float(cell)
            if not math.isfinite(value):
                raise ValueError
        except ValueError as error:
            raise ValueError(f"{label} has a nonnumeric or non-finite value in row {index}.") from error
        values.append(value)
    return values


def run_column_formula(columns, rows, options, inputs):
    expression, references = parse_formula(options["expression"])
    column = options["column"]
    if column >= len(columns):
        raise ValueError("Choose an available output column.")
    vectors = {}
    constants = {}
    if "value" in expression.co_names:
        vectors["value"] = formula_values(rows, column, columns[column])
    for token, (variable, _, column_name) in references.items():
        if token not in inputs:
            raise ValueError(f"No input is bound to {token}.")
        worksheet, input_column = inputs[token]
        if input_column >= len(worksheet.columns):
            raise ValueError(f"{token} refers to a missing column.")
        size = len(worksheet.rows)
        if column_name is None and (size != 1 or len(worksheet.columns) != 1):
            raise ValueError(f"{token} must contain exactly one value when no column is named.")
        if size not in (1, len(rows)):
            raise ValueError(f"{token} has {size} rows. Use one row or match the output worksheet's {len(rows)} rows.")
        values = formula_values(worksheet.rows, input_column, token)
        if size == 1:
            constants[variable] = values[0]
        else:
            vectors[variable] = values

    context = {"__builtins__": {}, **FORMULA_FUNCTIONS}
    output = []
    for index, row in enumerate(rows):
        variables = {**constants, **{key: values[index] for key, values in vectors.items()}}
        result = None
        if all(value is not None for value in variables.values()):
            try:
                result = eval(expression, context, variables)
                if type(result) not in (int, float) or not math.isfinite(result):
                    raise ValueError
            except (ArithmeticError, TypeError, ValueError) as error:
                raise ValueError(f"The formula does not give a finite number in row {index + 1}.") from error
        output.append((*row[:column], result, *row[column + 1:]))
    return {"traces": [], "sources": {
        "calculated": {"name": columns[column] or f"Column {column + 1}", "columns": columns, "rows": output},
    }}
