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

const LAST_THEME_KEY = "ra-theme-last";

/**
 * A random colour theme on every load — deliberate, and a lot of the charm: the
 * app feels different each time you open it. The other axes persist; only the
 * colour is rerolled.
 *
 * **Never the same one twice running.** A uniform roll over four themes repeats
 * a quarter of the time, and two or three greens in a row reads as "it always
 * gives me green" — which is exactly the complaint, and is what randomness
 * actually looks like rather than a bug. Excluding the previous pick turns
 * "random" into what people mean by it: a different one every time.
 *
 * Stored separately from the settings blob because it is not a preference, it
 * is a memory of the last roll — and if reading it fails the roll simply falls
 * back to uniform.
 */
function randomColorTheme(): ColorTheme {
  let previous: string | null = null;
  try {
    previous = localStorage.getItem(LAST_THEME_KEY);
  } catch {
    // Private-mode Safari throws rather than returning null.
  }

  const choices = COLOR_THEMES.filter((theme) => theme !== previous);
  const pool = choices.length > 0 ? choices : COLOR_THEMES;
  const picked = pool[Math.floor(Math.random() * pool.length)]!;

  try {
    localStorage.setItem(LAST_THEME_KEY, picked);
  } catch {
    // Not being able to remember only costs the no-repeat guarantee.
  }
  return picked;
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
  // Rolled exactly once per load, and that matters now the roll remembers what
  // it last returned: the old shape built a `fallback` object eagerly and then
  // rolled *again* on the path that actually ran, so the "previous" theme being
  // avoided was a throwaway from milliseconds earlier rather than the one the
  // user last saw — and the no-repeat guarantee quietly did nothing.
  const colorTheme = randomColorTheme();
  const defaults: ThemeSettings = {
    colorTheme,
    layoutDensity: "default",
    typography: "system",
    textSize: "0",
  };

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return defaults;

    const parsed = JSON.parse(saved) as Partial<ThemeSettings>;
    return {
      colorTheme,
      layoutDensity: oneOf(DENSITIES, parsed.layoutDensity, "default"),
      typography: oneOf(TYPOGRAPHIES, parsed.typography, "system"),
      // Both of these unions were renamed, so anyone carrying the old values
      // ("larger", "display") lands on the fallback rather than on a class that
      // does not exist. `oneOf` already did that; it is the reason the rename
      // did not need a migration.
      textSize: oneOf(TEXT_SIZES, parsed.textSize, "0"),
    };
  } catch {
    // Private-mode Safari throws on localStorage rather than returning null.
    // Preferences are a nicety; never let them break the app.
    return defaults;
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

    // `text-size-` rather than `text-`: the old prefix produced `.text-larger`,
    // which was one rename away from colliding with a Tailwind `text-*` utility.
    root.classList.remove(...TEXT_SIZES.map((t) => `text-size-${t}`));
    root.classList.add(`text-size-${settings.textSize}`);
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
