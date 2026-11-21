import type { Appearance } from "./workspace";

const defaultAppearance: Appearance = { theme: "system", accent: "#245883" };

function rgb(hex: string) {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
}

function luminance(color: number[]) {
  const values = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}

function contrast(first: number[], second: number[]) {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function applyAppearance(appearance: Appearance) {
  const root = document.documentElement;
  const dark = appearance.theme === "dark" || (appearance.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  root.dataset.theme = dark ? "dark" : "light";
  const accent = rgb(appearance.accent);
  const panel = dark ? rgb("#222a35") : [255, 255, 255];
  const ink = [...accent];
  const target = dark ? 255 : 0;
  for (let step = 0; contrast(ink, panel) < 4.5 && step < 40; step++) {
    ink.forEach((value, index) => { ink[index] = Math.round(value * 0.9 + target * 0.1); });
  }
  root.style.setProperty("--accent", appearance.accent);
  root.style.setProperty("--accent-ink", `rgb(${ink.join(",")})`);
  root.style.setProperty("--accent-soft", `rgb(${accent.map((value, index) => Math.round(value * 0.18 + panel[index] * 0.82)).join(",")})`);
  root.style.setProperty("--accent-contrast", contrast(accent, [255, 255, 255]) >= contrast(accent, [0, 0, 0]) ? "#ffffff" : "#000000");
}

export function cachedAppearance(): Appearance {
  try {
    const value = JSON.parse(localStorage.getItem("nigiro.appearance") ?? "null") as Appearance | null;
    if (value && ["system", "light", "dark"].includes(value.theme) && /^#[0-9a-f]{6}$/i.test(value.accent)) return value;
  } catch { /* Use the default theme when preferences cannot be read. */ }
  return defaultAppearance;
}

export function cacheAppearance(appearance: Appearance) {
  try { localStorage.setItem("nigiro.appearance", JSON.stringify(appearance)); }
  catch { /* The analysis engine also saves appearance preferences. */ }
}
