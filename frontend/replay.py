def replay_inputs(payload):
    source = io.StringIO(newline="")
    writer = csv.writer(source)
    writer.writerow(payload["columns"])
    writer.writerows(payload["rows"])
    operation_types = {
        "correct_cell": Correction,
        "linear_fit": LinearFit,
        "plot": Plot,
        "figure_color": FigureColor,
        "figure_style": FigureStyle,
    }
    operations = []
    for record in payload["operations"]:
        fields = dict(record)
        operation_type = operation_types[fields.pop("kind")]
        operations.append(operation_type(**fields))
    project = Project(Source(payload["source_name"], source.getvalue().encode("utf-8")), tuple(operations))
    project.validate()
    return project


def replay_figure(project, figure):
    recipe = project.figure
    traces = figure["traces"]
    if isinstance(recipe, LinearFit):
        result = run_linear_fit(project.worksheet, recipe)
        x = result.x.tolist()
        y = result.y.tolist()
        fitted = result.fitted.tolist()
        first = x.index(min(x))
        last = x.index(max(x))

        def interpolate(values):
            fractions = (i / 200 for i in range(201))
            return [(1 - t) * values[first] + t * values[last] for t in fractions]

        traces[0].update(x=x, y=y)
        traces[1].update(x=interpolate(x), y=interpolate(fitted))
        traces[2].update(x=x, y=result.residuals.tolist())
    elif isinstance(recipe, Plot):
        result = run_plot(project.worksheet, recipe)
        if recipe.plot_type == "bar":
            positions = list(range(len(result.x)))
            labels = [escape(str(value), quote=False).replace("\n", "<br>") for value in result.x]
            traces[0].update(x=positions, y=result.y, text=labels)
            figure["layout"]["xaxis"].update(tickvals=positions, ticktext=labels)
        else:
            traces[0].update(x=result.x, y=result.y)
    else:
        raise ValueError("The recipe has no figure.")
    return figure


def render_svg(figure, browser_executable, font):
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

    figure = replay_figure(replay_inputs(payload), payload["figure"])
    font = (Path(get_data_path()) / "fonts" / "ttf" / "DejaVuSans.ttf").read_bytes()
    svg = render_svg(figure, args.browser_executable, font)
    with TemporaryDirectory() as directory:
        fonts = Path(directory)
        (fonts / "DejaVuSans.ttf").write_bytes(font)
        write_figure(output, svg, args.scale, fonts)
