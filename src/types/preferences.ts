export const COLOR_THEMES = ["neon", "vapor", "matrix", "sunset"] as const;
export const DENSITIES = ["tight", "default", "airy"] as const;
export const TYPOGRAPHIES = ["system", "mono", "display"] as const;
export const NAV_STYLES = ["standard", "tabs", "minimal"] as const;

export type ColorTheme = (typeof COLOR_THEMES)[number];
export type LayoutDensity = (typeof DENSITIES)[number];
export type Typography = (typeof TYPOGRAPHIES)[number];
export type NavStyle = (typeof NAV_STYLES)[number];

export interface ThemeSettings {
  colorTheme: ColorTheme;
  layoutDensity: LayoutDensity;
  typography: Typography;
  navStyle: NavStyle;
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
  { value: "display", label: "Display", desc: "Bold headlines" },
];

export const NAV_OPTIONS: { value: NavStyle; label: string; desc: string }[] = [
  { value: "standard", label: "Standard", desc: "Date strip" },
  { value: "tabs", label: "Tabs", desc: "Bottom bar" },
  { value: "minimal", label: "Minimal", desc: "Swipe only" },
];
