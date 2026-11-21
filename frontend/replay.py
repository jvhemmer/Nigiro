def replay_inputs(payload):
    sources = [
        Source(record["name"], b64decode(record["content"]), record["encoding"], record["delimiter"])
        for record in payload["recipe"]["sources"]
    ]
    operation_types = {
        "correct_cell": Correction,
        "scale_column": ScaleColumn,
        "linear_fit": LinearFit,
        "plot": Plot,
        "plugin": PluginStep,
        "figure_color": FigureColor,
        "figure_style": FigureStyle,
        "figure_appearance": FigureAppearance,
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


def replay_plugin(project, plugin, source):
    worksheet = (
        Worksheet(tuple(source["columns"]), tuple(map(tuple, source["rows"])))
        if source is not None else project.worksheet
    )
    args = worksheet.columns, worksheet.rows, plugin["options"].copy()
    if plugin["source"] is None:
        manifest, runner = BUILTINS[plugin["plugin_id"]]
        if manifest["version"] != plugin["version"]:
            raise ValueError("The bundled plugin version does not match the saved recipe.")
        result = runner(*args)
        if plugin.get("part"):
            result = linear_fit_view(result, plugin["part"])
    else:
        result = run_plugin_source(plugin["source"], plugin["plugin_id"], *args)

    return result


def replay_figure(project, figure, recipe):
    figures = {}
    tables = {}
    residuals = {}
    overlays = recipe["overlays"]
    project.working_worksheets
    for key, record in project.figures.items():
        if record.overlay:
            continue
        if record.fit_id is not None:
            figures[key] = residuals[record.fit_id]
            continue
        plugin = recipe["plugins"][str(key)]
        source_id = plugin["source_id"]
        source = (
            project.worksheet_for_recipe(source_id, record.recipe) if source_id in project.raw_sources
            else tables[source_id]
        )
        result = replay_plugin(project, plugin, {"columns": source.columns, "rows": source.rows})
        outputs = output_tables(result, plugin["analysis"])
        tables.update({f"{key}:{name}": table for name, table in outputs.items()})
        if record.part == "fit":
            residuals[key] = linear_fit_view(result, "residual")
            result = linear_fit_view(result, "fit")
        figures[key] = result
    target = recipe["figure_id"]
    if str(target) in overlays:
        overlay = overlays[str(target)]
        result = overlay_figures([figures[key] for key in overlay["members"]], overlay["labels"], overlay["preserve_first"])
    else:
        result = figures[target]
    return {
        **figure,
        "traces": [merge_style(trace, style) for trace, style in zip(result["traces"], figure["traces"], strict=True)],
        "layout": merge_style(result.get("layout", {}), figure["layout"]),
    }


def render_svg(figure, browser_executable, font, embedded_fonts):
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
        page.add_script_tag(content=get_plotlyjs())
        return page.evaluate(
            """async ({ traces, layout, width, height }) => {
                const node = document.getElementById("figure");
                document.body.style.margin = "0";
                await document.fonts.load('12px "DejaVu Sans"');
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
    embedded_fonts = payload.get("fonts", [])
    svg = render_svg(figure, args.browser_executable, font, embedded_fonts)
    with TemporaryDirectory() as directory:
        fonts = Path(directory)
        (fonts / "DejaVuSans.ttf").write_bytes(font)
        from base64 import b64decode

        for index, embedded in enumerate(embedded_fonts):
            (fonts / f"embedded-{index}{embedded['extension']}").write_bytes(b64decode(embedded["data"]))
        write_figure(output, svg, args.scale, fonts)
