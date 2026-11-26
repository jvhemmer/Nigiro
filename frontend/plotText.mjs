const latexEscapes = {
  "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", "%": "\\%", "$": "\\$",
  "&": "\\&", "#": "\\#", "_": "\\_", "^": "\\textasciicircum{}", "~": "\\textasciitilde{}",
};

const greek = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega".split(" ");
const inlineSymbols = new Map([
  ...greek.map((name, index) => [name, [..."αβγδεζηθικλμνξοπρστυφχψω"][index]]),
  ...greek.map((name, index) => [name[0].toUpperCase() + name.slice(1), [..."ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ"][index]]),
  ...Object.entries({ varepsilon: "ϵ", vartheta: "ϑ", varphi: "ϕ", varpi: "ϖ", varrho: "ϱ", varsigma: "ς",
    times: "×", cdot: "·", pm: "±", mp: "∓", div: "÷", le: "≤", leq: "≤", ge: "≥", geq: "≥",
    ne: "≠", neq: "≠", approx: "≈", infty: "∞", partial: "∂", degree: "°", to: "→" }),
]);
const inlineStyles = new Map([["text", ""], ["mathrm", ""], ["mathbf", "b"], ["mathit", "i"]]);
const mathSpan = /(?<!\\)\$([^$]+)(?<!\\)\$/g;

function escapePlotText(text) {
  return escapeLabel(text).replaceAll("$", "&#36;");
}

function escapeLabel(text) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\n", "<br>");
}

export function decodePlotText(text) {
  return text.replaceAll("<br>", "\n").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

function enclosed(tag, text) {
  return tag ? `<${tag}>${text}</${tag}>` : text;
}

function inlineMath(expression) {
  const tokens = expression.match(/\\(?:[A-Za-z]+|.)|[\s\S]/gu) ?? [];
  let position = 0;

  function atom(style, depth) {
    if (depth > 32) return null;
    const token = tokens[position++];
    if (!token || token === "}" || token === "_" || token === "^") return null;
    if (token === "{") {
      const text = sequence(style, depth + 1);
      return tokens[position++] === "}" ? text : null;
    }
    if (token.startsWith("\\")) {
      const command = token.slice(1);
      if (inlineStyles.has(command) && tokens[position] === "{") {
        return atom(inlineStyles.get(command), depth + 1);
      }
      const symbol = inlineSymbols.get(command);
      if (symbol) return enclosed(/\p{L}/u.test(symbol) ? style : "", symbol);
      if (/^[{}_^% #&]$/.test(command)) return escapePlotText(command);
      return null;
    }
    return enclosed(/\p{L}/u.test(token) ? style : "", escapePlotText(token === "-" ? "−" : token));
  }

  function sequence(style, depth) {
    let text = "";
    while (position < tokens.length && tokens[position] !== "}") {
      const token = tokens[position];
      const script = token === "^" ? "sup" : token === "_" ? "sub" : "";
      if (script) position++;
      const value = atom(style, depth);
      if (value === null) return null;
      text += enclosed(script, value);
    }
    return text;
  }

  const text = sequence("i", 0);
  return text !== null && position === tokens.length ? text : null;
}

export function plotText(text, renderer = "auto", math) {
  function formatMath(expression) {
    const command = { default: "", roman: "mathrm", sans: "mathsf", mono: "mathtt" }[math?.math_alphabet ?? "default"];
    const body = command ? `\\${command}{${expression}}` : expression;
    const preamble = math?.math_preamble.trim();
    return preamble ? "$" + `{${preamble}\n${body}}$` : `$${body}$`;
  }
  if (!text) return text;
  if (renderer === "inline") return text.split(mathSpan).map((part, index) =>
    index % 2 ? inlineMath(part) ?? escapePlotText(`$${part}$`) : escapePlotText(part)).join("");
  if (renderer !== "plain") {
    const parts = text.split(mathSpan);
    if (parts.length > 1) {
      const expression = parts.map((part, index) => index % 2 || !part ? part
        : `\\text{${part.replace(/[\\{}%$&#_^~]/g, (character) => latexEscapes[character])}}`).join("");
      return formatMath(expression);
    }
    if (renderer === "latex") return formatMath(text);
  }
  return escapePlotText(text);
}

export function plotLegendText(text, renderer = "auto", math, literal = false) {
  const decoded = literal ? text : decodePlotText(text);
  if (renderer === "plain") return plotText(decoded, renderer, math);
  const label = decoded.replace(/(?<![\\$])\$\$([^$]+)(?<!\\)\$\$(?!\$)/g,
    (_, expression) => `$${expression}$`);
  if (renderer !== "auto") return plotText(label, renderer, math);

  const expressions = [...label.matchAll(mathSpan)];
  if (expressions.length === 0) return literal ? escapeLabel(text) : text;
  const inline = expressions.every(([, expression]) => inlineMath(expression) !== null);
  return plotText(label, inline ? "inline" : "auto", math);
}

export function formatPlotTicks(layout, renderers, math) {
  for (const [key, renderer] of Object.entries(renderers)) {
    const axis = layout[key];
    if (!Array.isArray(axis?.ticktext)) continue;
    axis.ticktext = axis.ticktext.map((text) => {
      if (typeof text !== "string" || (renderer === "auto" && !/\$[^$]+\$/.test(text))) return text;
      return plotText(decodePlotText(text), renderer, math);
    });
  }
}
