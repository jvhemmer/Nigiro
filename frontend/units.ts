export const lengthUnits: Record<string, number> = {
  px: 1, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6,
};
export const angleUnits: Record<string, number> = { deg: 1, "°": 1, rad: 180 / Math.PI, turn: 360 };

export function parseMeasurement(text: string, angle = false) {
  const match = text.trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*([a-z°]*)$/i);
  const unit = match?.[2].toLowerCase() || (angle ? "deg" : "px");
  const factor = (angle ? angleUnits : lengthUnits)[unit];
  const value = match ? Number(match[1]) * factor : NaN;
  return { value, unit, valid: Number.isFinite(value) && factor !== undefined };
}

export function formatMeasurement(value: number | null, unit: string, angle = false) {
  if (value === null || !Number.isFinite(value)) return "";
  const factor = (angle ? angleUnits : lengthUnits)[unit];
  return `${Number((value / factor).toPrecision(12))} ${unit}`;
}
