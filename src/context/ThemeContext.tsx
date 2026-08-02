import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  COLOR_THEMES,
  DENSITIES,
  TEXT_SIZES,
  TYPOGRAPHIES,
  type ColorTheme,
  type LayoutDensity,
  type TextSize,
  type ThemeSettings,
  type Typography,
} from "@/types/preferences";

const STORAGE_KEY = "ra-theme-settings";

interface ThemeContextType extends ThemeSettings {
  setColorTheme: (theme: ColorTheme) => void;
  setLayoutDensity: (density: LayoutDensity) => void;
  setTypography: (typography: Typography) => void;
  setTextSize: (size: TextSize) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/**
 * A random colour theme on every load. This is deliberate and carried over from
 * the original — the app feels different each time you open it, which is a lot
 * of the charm. The other three axes persist; only the colour is rerolled.
 * Make this read `parsed.colorTheme` if you'd rather it stuck.
 */
function randomColorTheme(): ColorTheme {
  return COLOR_THEMES[Math.floor(Math.random() * COLOR_THEMES.length)]!;
}

function oneOf<T extends readonly string[]>(
  allowed: T,
  value: unknown,
  fallback: T[number],
): T[number] {
  return typeof value === "string" && allowed.includes(value)
    ? (value as T[number])
    : fallback;
}

function readSettings(): ThemeSettings {
  const fallback: ThemeSettings = {
    colorTheme: randomColorTheme(),
    layoutDensity: "default",
    typography: "system",
    textSize: "default",
  };

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return fallback;

    const parsed = JSON.parse(saved) as Partial<ThemeSettings>;
    return {
      colorTheme: randomColorTheme(),
      layoutDensity: oneOf(DENSITIES, parsed.layoutDensity, "default"),
      typography: oneOf(TYPOGRAPHIES, parsed.typography, "system"),
      textSize: oneOf(TEXT_SIZES, parsed.textSize, "default"),
    };
  } catch {
    // Private-mode Safari throws on localStorage rather than returning null.
    // Preferences are a nicety; never let them break the app.
    return fallback;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ThemeSettings>(readSettings);

  // Themes, density and typography are all plain classes on <html>, so applying
  // a preference is a handful of class writes rather than a re-render of every
  // styled component.
  useEffect(() => {
    const root = document.documentElement;

    root.classList.remove(...COLOR_THEMES.map((t) => `theme-${t}`));
    root.classList.add(`theme-${settings.colorTheme}`);

    root.classList.remove(...DENSITIES.map((d) => `density-${d}`));
    root.classList.add(`density-${settings.layoutDensity}`);

    // `type-` not `font-`: `.font-mono` would collide with Tailwind's utility.
    root.classList.remove(...TYPOGRAPHIES.map((t) => `type-${t}`));
    root.classList.add(`type-${settings.typography}`);

    root.classList.remove(...TEXT_SIZES.map((t) => `text-${t}`));
    root.classList.add(`text-${settings.textSize}`);
  }, [
    settings.colorTheme,
    settings.layoutDensity,
    settings.typography,
    settings.textSize,
  ]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Ignore quota / private-mode failures.
    }
  }, [settings]);

  const setColorTheme = useCallback(
    (colorTheme: ColorTheme) => setSettings((s) => ({ ...s, colorTheme })),
    [],
  );
  const setLayoutDensity = useCallback(
    (layoutDensity: LayoutDensity) => setSettings((s) => ({ ...s, layoutDensity })),
    [],
  );
  const setTypography = useCallback(
    (typography: Typography) => setSettings((s) => ({ ...s, typography })),
    [],
  );
  const setTextSize = useCallback(
    (textSize: TextSize) => setSettings((s) => ({ ...s, textSize })),
    [],
  );

  const value = useMemo<ThemeContextType>(
    () => ({
      ...settings,
      setColorTheme,
      setLayoutDensity,
      setTypography,
      setTextSize,
    }),
    [settings, setColorTheme, setLayoutDensity, setTypography, setTextSize],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
