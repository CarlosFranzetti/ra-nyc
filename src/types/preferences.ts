export const COLOR_THEMES = ["noir", "midnight", "ember", "neon"] as const;
export const DENSITIES = ["compact", "comfortable", "spacious"] as const;
export const NAV_MODES = ["standard", "tabs", "minimal"] as const;

export type ColorTheme = (typeof COLOR_THEMES)[number];
export type Density = (typeof DENSITIES)[number];
export type NavMode = (typeof NAV_MODES)[number];

export interface Preferences {
  theme: ColorTheme;
  density: Density;
  navMode: NavMode;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "noir",
  density: "comfortable",
  navMode: "standard",
};

export const THEME_LABELS: Record<ColorTheme, string> = {
  noir: "Noir",
  midnight: "Midnight",
  ember: "Ember",
  neon: "Neon",
};

export const DENSITY_LABELS: Record<Density, string> = {
  compact: "Compact",
  comfortable: "Comfortable",
  spacious: "Spacious",
};

export const NAV_MODE_LABELS: Record<NavMode, string> = {
  standard: "Standard",
  tabs: "Tabs",
  minimal: "Minimal",
};

export const NAV_MODE_HINTS: Record<NavMode, string> = {
  standard: "Scrolling date strip",
  tabs: "Fixed day tabs",
  minimal: "Swipe only — no date UI",
};

/** Swatch colours for the settings UI, mirroring each theme's tokens. */
export const THEME_SWATCHES: Record<ColorTheme, [string, string]> = {
  noir: ["hsl(0 0% 10%)", "hsl(0 0% 100%)"],
  midnight: ["hsl(222 47% 11%)", "hsl(213 94% 68%)"],
  ember: ["hsl(20 14% 8%)", "hsl(24 95% 58%)"],
  neon: ["hsl(280 30% 8%)", "hsl(315 96% 62%)"],
};
