import type { FigureStyle, TextRenderer } from "./figureStyle";

type MathStyle = Pick<FigureStyle, "math_alphabet" | "math_preamble">;

export function plotText(text: string, renderer?: TextRenderer, math?: MathStyle): string;
export function decodePlotText(text: string): string;
export function formatPlotTicks(layout: object, renderers: Record<string, TextRenderer>, math: MathStyle): void;
