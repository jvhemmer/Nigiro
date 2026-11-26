def replay_inputs(payload):
    sources = []
    for record in payload["recipe"]["sources"]:
        if "scalar_value" in record:
            sources.append(Source.scalar(record["name"], record["scalar_value"], formula=record.get("scalar_formula")))
            continue
        path = Path(__file__).resolve().parent / record["path"]
        try:
            content = path.read_bytes()
        except OSError as error:
            raise ValueError(f"Could not read data file {path}. Check the source path in PAYLOAD.") from error
        options = TextImport(**record["text_import"]) if "text_import" in record else None
        sources.append(Source(record["name"], content, record["encoding"], record["delimiter"], text_import=options))
    operation_types = {
        "correct_cell": Correction,
        "scale_column": ScaleColumn,
        "linear_fit": LinearFit,
        "plot": Plot,
        "plugin": PluginStep,
        "figure_color": FigureColor,
        "figure_style": FigureStyle,
        "figure_appearance": FigureAppearance,
        "trace_appearance": TraceAppearance,
        "residual_figure": ResidualFigure,
        "item_edit": ItemEdit,
        "overlay_figure": OverlayFigure,
        "add_figure_layers": AddFigureLayers,
    }
    operations = []
    for record in payload["operations"]:
        fields = dict(record)
        operation_type = operation_types[fields.pop("kind")]
        operations.append(operation_type(**fields))
    return Project(sources[0] if sources else None, tuple(operations), additional_sources=tuple(sources[1:]))


def merge_style(original, changes):
    merged = original.copy()
    for key, value in changes.items():
        before = merged.get(key)
        merged[key] = merge_style(before, value) if isinstance(before, dict) and isinstance(value, dict) else value
    return merged


def replay_plugin(plugin, worksheet, references):
    args = worksheet.columns, worksheet.rows, plugin["options"].copy()
    for key in plugin.get("named_columns", ()):
        value = args[2][key]
        args[2][key] = ([worksheet.column_index(selection) for selection in value] if isinstance(value, list)
                        else worksheet.column_index(value))
    if plugin.get("input_mode") == "joint":
        args[2].update({key: column for key, (_, column) in references.items()})
        args = (*args, Project.joint_inputs(references))
    if plugin["source"] is None:
        manifest, runner = BUILTINS[plugin["plugin_id"]]
        if manifest["version"] != plugin["version"]:
            raise ValueError("The bundled plugin version does not match the saved recipe.")
        result = runner(*args, references) if plugin["plugin_id"] in REFERENCE_FORMULA_PLUGINS else runner(*args)
        if plugin.get("part"):
            result = linear_fit_view(result, plugin["part"])
    else:
        script = plugin.get("worker")
        if script is None:
            return run_plugin_source(plugin["source"], plugin["plugin_id"], *args)

        import subprocess
        worker = Path(__file__).resolve().parent / script
        try:
            process = subprocess.run(
                ["uv", "run", "--script", str(worker)],
                input=json.dumps([plugin["source"], plugin["plugin_id"], *args]),
                stdout=subprocess.PIPE, encoding="utf-8", check=True,
            )
        except FileNotFoundError as error:
            raise ValueError("Install uv to replay plugins with pinned dependencies.") from error
        except subprocess.CalledProcessError as error:
            raise ValueError(f"Could not replay {plugin['plugin_id']}. See the Python error above.") from error
        result = json.loads(process.stdout)

    return result


def replay_figure(project, figure, recipe):
    figures = {}
    tables = {}
    residuals = {}
    overlays = recipe["overlays"]
    project.working_worksheets
    raw_sources = project.raw_sources.copy()
    formulas = iter((key, source) for key, source in raw_sources.items() if source.scalar_formula is not None)
    pending = next(formulas, None)
    for key, record in project.figures.items():
        while pending is not None and pending[1].scalar_formula["position"] <= key:
            source_id, source = pending
            raw_sources[source_id] = project.scalar_from_formula(source.name, source.scalar_formula, tables)
            project = replace(project, source=raw_sources[None], additional_sources=tuple(raw_sources.values())[1:])
            pending = next(formulas, None)
        if record.overlay:
            continue
        if record.fit_id is not None:
            figures[key] = residuals[record.fit_id]
            continue
        plugin = recipe["plugins"][str(key)]
        source = (project.plugin_input(record.recipe, tables) if isinstance(record.recipe, PluginStep)
                  else project.recipe_input(plugin["source_id"], record.recipe, tables))
        result = replay_plugin(plugin, source, project.recipe_references(record.recipe, tables) if isinstance(record.recipe, PluginStep) else {})
        outputs = output_tables(result, plugin["analysis"])
        tables.update({f"{key}:{name}": table for name, table in outputs.items()})
        if record.part == "fit":
            residuals[key] = linear_fit_view(result, "residual")
            result = linear_fit_view(result, "fit")
        figures[key] = result
    combined = {}

    def resolve(key):
        overlay = overlays.get(str(key))
        if overlay is None:
            return figures[key]
        if key not in combined:
            count = overlay.get("combined_input_count", 0)
            inputs = [resolve(member) if index < count else figures[member]
                      for index, member in enumerate(overlay["members"])]
            combined[key] = overlay_figures(inputs, overlay["labels"], overlay["preserve_first"], single_axes=bool(count))
        return combined[key]

    result = resolve(recipe["figure_id"])
    return {
        **figure,
        "traces": [merge_style(trace, style) for trace, style in zip(result["traces"], figure["traces"], strict=True)],
        "layout": merge_style(result.get("layout", {}), figure["layout"]),
    }


def render_svg(figure, browser_executable, font, embedded_fonts, mathjax=None, tick_formatter=None):
    dimensions = {key: figure[key] for key in ("width", "height")}
    from playwright.sync_api import sync_playwright
    from plotly.offline import get_plotlyjs

    encoded_font = b64encode(font).decode("ascii")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=browser_executable)
        page = browser.new_page(viewport=dimensions)
        page.set_content('<div id="figure"></div>')
        page.add_style_tag(content=(
            '@font-face {font-family: "DejaVu Sans"; '
            f'src: url(data:font/ttf;base64,{encoded_font}) format("truetype");}}'
        ))
        if embedded_fonts:
            page.evaluate(
                """async (fonts) => {
                    for (const font of fonts) {
                        const face = new FontFace(font.family, 'url(data:application/octet-stream;base64,' + font.data + ')',
                            { weight: font.weight, style: font.style });
                        await face.load();
                        document.fonts.add(face);
                    }
                }""",
                embedded_fonts,
            )
        if mathjax:
            from gzip import decompress

            page.evaluate("window.MathJax = {startup: {typeset: false}, svg: {fontCache: 'none'}}")
            page.add_script_tag(content=decompress(mathjax.read_bytes()).decode("utf-8"))
            page.evaluate("MathJax.startup.promise.then(() => true)")
        if tick_formatter:
            page.add_script_tag(path=tick_formatter)
        page.add_script_tag(content=get_plotlyjs())
        return page.evaluate(
            """async ({ traces, layout, width, height, tick_renderers, tick_math }) => {
                const node = document.getElementById("figure");
                document.body.style.margin = "0";
                await document.fonts.load('12px "DejaVu Sans"');
                if (Object.keys(tick_renderers).length) formatPlotTicks(layout, tick_renderers, tick_math);
                await Plotly.newPlot(node, traces, { ...layout, width, height }, {
                    responsive: false, displayModeBar: false
                });
                const url = await Plotly.toImage(node, { format: "svg", width, height });
                return decodeURIComponent(url.slice(url.indexOf(",") + 1));
            }""",
            figure,
        )


def main():
    from matplotlib import get_data_path

    payload = PAYLOAD
    settings = payload["export_settings"]
    formats = ("png", "pdf")
    parser = argparse.ArgumentParser(description="Replay the Nigiro analysis and write a PNG or PDF.")
    parser.add_argument("--format", choices=formats, help=f"Figure format. Saved choice: {settings['format']}.")
    parser.add_argument("--scale", type=int, choices=range(1, 5), default=settings["scale"], help="PNG resolution multiplier.")
    parser.add_argument("--output", type=Path, help="Output file path. Use the .png or .pdf extension.")
    parser.add_argument("--browser-executable", help="Path to an installed Chromium or Chrome executable.")
    args = parser.parse_args()
    if args.output:
        extension = args.output.suffix.lower().removeprefix(".")
        if extension not in formats or (args.format and args.format != extension):
            parser.error("Use an output extension that matches the PNG or PDF format.")
        output = args.output
    else:
        extension = args.format or settings["format"]
        output = Path(__file__).with_suffix(f".{extension}")

    figure = replay_figure(
        replay_inputs(payload), payload["figure"], payload["recipe"],
    )
    font = (Path(get_data_path()) / "fonts" / "ttf" / "DejaVuSans.ttf").read_bytes()
    folder = Path(__file__).resolve().parent
    embedded_fonts = [
        {**item, "data": b64encode((folder / item["path"]).read_bytes()).decode("ascii")}
        for item in payload.get("fonts", [])
    ]
    mathjax = folder / payload["mathjax"] if "mathjax" in payload else None
    tick_formatter = folder / payload["tick_formatter"] if "tick_formatter" in payload else None
    svg = render_svg(figure, args.browser_executable, font, embedded_fonts, mathjax, tick_formatter)
    with TemporaryDirectory() as directory:
        fonts = Path(directory)
        (fonts / "DejaVuSans.ttf").write_bytes(font)
        for index, embedded in enumerate(embedded_fonts):
            (fonts / f"embedded-{index}{embedded['extension']}").write_bytes((folder / embedded["path"]).read_bytes())
        write_figure(output, svg, args.scale, fonts)
