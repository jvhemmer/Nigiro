const latexEscapes = {
  "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", "%": "\\%", "$": "\\$",
  "&": "\\&", "#": "\\#", "_": "\\_", "^": "\\textasciicircum{}", "~": "\\textasciitilde{}",
};

export function plotText(text, renderer = "auto", math) {
  function formatMath(expression) {
    const command = { default: "", roman: "mathrm", sans: "mathsf", mono: "mathtt" }[math?.math_alphabet ?? "default"];
    const body = command ? `\\${command}{${expression}}` : expression;
    const preamble = math?.math_preamble.trim();
    return preamble ? "$" + `{${preamble}\n${body}}$` : `$${body}$`;
  }
  if (!text) return text;
  if (renderer !== "plain") {
    const parts = text.split(/(?<!\\)\$([^$]+)(?<!\\)\$/g);
    if (parts.length > 1) {
      const expression = parts.map((part, index) => index % 2 || !part ? part
        : `\\text{${part.replace(/[\\{}%$&#_^~]/g, (character) => latexEscapes[character])}}`).join("");
      return formatMath(expression);
    }
    if (renderer === "latex") return formatMath(text);
  }
  return text.replaceAll("&", "&amp;").replaceAll("$", "&#36;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\n", "<br>");
}

export function formatPlotTicks(layout, renderers, math) {
  for (const [key, renderer] of Object.entries(renderers)) {
    const axis = layout[key];
    if (!Array.isArray(axis?.ticktext)) continue;
    axis.ticktext = axis.ticktext.map((text) => {
      if (typeof text !== "string" || (renderer === "auto" && !/\$[^$]+\$/.test(text))) return text;
      const label = text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
      return plotText(label, renderer, math);
    });
  }
}
