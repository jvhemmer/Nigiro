import assert from "node:assert/strict";
import test from "node:test";
import { formatPlotTicks, plotText } from "../frontend/plotText.mjs";

test("inline math keeps native text for labels, symbols, and scripts", () => {
  assert.equal(plotText("Current $i$ (A)", "inline"), "Current <i>i</i> (A)");
  assert.equal(plotText(String.raw`$\alpha$`, "inline"), "<i>α</i>");
  assert.equal(plotText("mA cm$^{-2}$", "inline"), "mA cm<sup>−2</sup>");
  assert.equal(plotText("E$_{1}$", "inline"), "E<sub>1</sub>");
});

test("inline math escapes literal text and leaves unsupported math visible", () => {
  assert.equal(plotText(String.raw`<label> $\frac{1}{2}$`, "inline"), "&lt;label&gt; &#36;\\frac{1}{2}&#36;");
  assert.equal(plotText("$i$", "plain"), "&#36;i&#36;");
  assert.equal(plotText("$i$", "auto"), "$i$");
});

test("inline math uses the same formatter for categorical tick labels", () => {
  const layout = { xaxis: { ticktext: ["&lt; $i_1$"] } };
  formatPlotTicks(layout, { xaxis: "inline" }, { math_alphabet: "default", math_preamble: "" });
  assert.deepEqual(layout.xaxis.ticktext, ["&lt; <i>i</i><sub>1</sub>"]);
});
