export const COLOR_THEMES = ["neon", "vapor", "matrix", "sunset"] as const;
export const DENSITIES = ["tight", "default", "airy"] as const;
export const TYPOGRAPHIES = ["base", "midnight", "latenight"] as const;

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
 * Ordered by background lightness — Vapor 4.5% down to Sunset 3.5% — so the row
 * itself reads as the ladder it is rather than as four unrelated dots.
 *
 * Hand-copied, so they drift if a theme's primary changes in `index.css` and
 * this does not — the swatch then advertises a colour the app never shows.
 */
export const THEME_OPTIONS: { value: ColorTheme; label: string; color: string }[] = [
  { value: "vapor", label: "Vapor", color: "hsl(320 88% 64%)" },
  { value: "neon", label: "Neon", color: "hsl(186 92% 52%)" },
  { value: "matrix", label: "Matrix", color: "hsl(142 69% 46%)" },
  { value: "sunset", label: "Sunset", color: "hsl(26 94% 58%)" },
];

export const DENSITY_OPTIONS: { value: LayoutDensity; label: string; desc: string }[] = [
  { value: "tight", label: "Tight", desc: "Dense layout" },
  { value: "default", label: "Default", desc: "Balanced" },
  { value: "airy", label: "Airy", desc: "Spacious" },
];

/**
 * Three rungs of a legibility ladder, not three flavours of typeface.
 *
 * The old set was System / Legible / Condensed — chosen so the three could not
 * be mistaken for one another at a glance, which is the right goal for a font
 * *picker* and the wrong one for this. Nobody browsing a listings app at 2am
 * outside a warehouse wants to pick a typeface; they want the screen to get
 * easier to read. So the axis is now how late it is, and every step up is both
 * a more readable face and a larger one — see index.css for the sizes.
 *
 *   Base        IBM Plex Sans at the app's own size. Where it starts.
 *   Midnight    the system face, a step larger.
 *   Late night  Barlow Semi Condensed, larger again — and narrower, which is
 *               the only reason a third and larger rung fits at all.
 *
 * Fjalla One went with the old shape, and with it the "Impact but lighter"
 * display slot that eight faces had been through. It answered the question that
 * used to be asked here and not the one being asked now: a poster face set 12%
 * larger is not a night mode.
 *
 * The stored values changed with the names, so a preference saved under the old
 * ones no longer matches and falls back to the default — see `oneOf` in
 * ThemeContext. That is one silent reset per person, once, in exchange for
 * stored values that mean what they say.
 *
 * Each preview renders in its own face, which is the only honest way to show a
 * font picker.
 */
export const TYPOGRAPHY_OPTIONS: {
  value: Typography;
  label: string;
  desc: string;
  /** Applied to the option's own label, so the button shows what it sells. */
  className: string;
}[] = [
  { value: "base", label: "Base", desc: "Open & distinct", className: "type-base" },
  { value: "midnight", label: "Midnight", desc: "A step larger", className: "type-midnight" },
  { value: "latenight", label: "Late night", desc: "Largest & narrow", className: "type-latenight" },
];
