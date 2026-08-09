export const COLOR_THEMES = ["neon", "vapor", "matrix", "sunset", "mono"] as const;
export const DENSITIES = ["tight", "default", "airy"] as const;
export const TYPOGRAPHIES = ["system", "impact", "slab"] as const;

/**
 * Six steps, not three, and the old default is now step 0 — the smallest.
 *
 * The previous three-way smaller/default/larger topped out at +10%, which is
 * not enough range to matter to anyone who actually needs bigger text, and
 * spent a third of its range going *down* from a size nobody complained about.
 * Every step from here is up.
 *
 * Stored as strings because the whole settings blob is JSON and these become
 * class names; the numbers are the ladder in `index.css`.
 */
export const TEXT_SIZES = ["0", "1", "2", "3", "4", "5"] as const;

export type ColorTheme = (typeof COLOR_THEMES)[number];
export type LayoutDensity = (typeof DENSITIES)[number];
export type Typography = (typeof TYPOGRAPHIES)[number];
export type TextSize = (typeof TEXT_SIZES)[number];

export interface ThemeSettings {
  colorTheme: ColorTheme;
  layoutDensity: LayoutDensity;
  typography: Typography;
  textSize: TextSize;
}

/**
 * Swatch colours for the settings UI, mirroring each theme's `--primary`.
 *
 * Hand-copied, so they drift if a theme's primary changes in `index.css` and
 * this does not — the swatch then advertises a colour the app never shows.
 */
export const THEME_OPTIONS: { value: ColorTheme; label: string; color: string }[] = [
  { value: "neon", label: "Neon", color: "hsl(186 92% 52%)" },
  { value: "vapor", label: "Vapor", color: "hsl(320 88% 64%)" },
  { value: "matrix", label: "Matrix", color: "hsl(142 76% 50%)" },
  { value: "sunset", label: "Sunset", color: "hsl(26 94% 58%)" },
  { value: "mono", label: "Mono", color: "hsl(0 0% 92%)" },
];

export const DENSITY_OPTIONS: { value: LayoutDensity; label: string; desc: string }[] = [
  { value: "tight", label: "Tight", desc: "Dense layout" },
  { value: "default", label: "Default", desc: "Balanced" },
  { value: "airy", label: "Airy", desc: "Spacious" },
];

/**
 * Three faces that cannot be mistaken for each other at a glance.
 *
 * The previous set failed that: JetBrains Mono and Atkinson Hyperlegible are
 * both moderate, evenly-coloured text faces, so beside system-ui the picker
 * offered three shades of the same idea. These are three *categories* — a
 * neutral sans, a compressed poster face, a slab — and each preview renders in
 * its own face, which is the only honest way to show a font picker.
 */
export const TYPOGRAPHY_OPTIONS: {
  value: Typography;
  label: string;
  desc: string;
  /** Applied to the option's own label, so the button shows what it sells. */
  className: string;
}[] = [
  { value: "system", label: "System", desc: "Clean & native", className: "type-system" },
  { value: "impact", label: "Impact", desc: "Tall & condensed", className: "type-impact" },
  { value: "slab", label: "Slab", desc: "Typewriter-ish", className: "type-slab" },
];
