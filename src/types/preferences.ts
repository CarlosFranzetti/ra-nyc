export const COLOR_THEMES = ["neon", "vapor", "matrix", "sunset"] as const;
export const DENSITIES = ["tight", "default", "airy"] as const;
export const TYPOGRAPHIES = ["system", "mono", "display"] as const;
export const TEXT_SIZES = ["smaller", "default", "larger"] as const;

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

/** Swatch colours for the settings UI, mirroring each theme's `--primary`. */
export const THEME_OPTIONS: { value: ColorTheme; label: string; color: string }[] = [
  { value: "neon", label: "Neon", color: "hsl(185 100% 50%)" },
  { value: "vapor", label: "Vapor", color: "hsl(320 100% 60%)" },
  { value: "matrix", label: "Matrix", color: "hsl(120 100% 45%)" },
  { value: "sunset", label: "Sunset", color: "hsl(25 100% 55%)" },
];

export const DENSITY_OPTIONS: { value: LayoutDensity; label: string; desc: string }[] = [
  { value: "tight", label: "Tight", desc: "Dense layout" },
  { value: "default", label: "Default", desc: "Balanced" },
  { value: "airy", label: "Airy", desc: "Spacious" },
];

export const TYPOGRAPHY_OPTIONS: { value: Typography; label: string; desc: string }[] = [
  { value: "system", label: "System", desc: "Clean & native" },
  { value: "mono", label: "Mono", desc: "JetBrains Mono" },
  { value: "display", label: "Display", desc: "Space Grotesk" },
];

/** Separate from density: this scales type only, that scales spacing only. */
export const TEXT_SIZE_OPTIONS: { value: TextSize; label: string; desc: string }[] = [
  { value: "smaller", label: "Smaller", desc: "More per screen" },
  { value: "default", label: "Default", desc: "Balanced" },
  { value: "larger", label: "Larger", desc: "Easier to read" },
];
