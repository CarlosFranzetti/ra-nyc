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
  DEFAULT_PREFERENCES,
  DENSITIES,
  NAV_MODES,
  type Preferences,
} from "@/types/preferences";

const STORAGE_KEY = "ra-nyc:preferences";

interface PreferencesContextValue {
  preferences: Preferences;
  setPreference: <K extends keyof Preferences>(
    key: K,
    value: Preferences[K],
  ) => void;
  reset: () => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

/**
 * Validates whatever came out of localStorage. Anything unrecognised falls back
 * to the default rather than being written to the DOM — a stale or hand-edited
 * value must never leave the app themeless.
 */
function readStoredPreferences(): Preferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;

    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      theme: COLOR_THEMES.includes(parsed.theme as never)
        ? (parsed.theme as Preferences["theme"])
        : DEFAULT_PREFERENCES.theme,
      density: DENSITIES.includes(parsed.density as never)
        ? (parsed.density as Preferences["density"])
        : DEFAULT_PREFERENCES.density,
      navMode: NAV_MODES.includes(parsed.navMode as never)
        ? (parsed.navMode as Preferences["navMode"])
        : DEFAULT_PREFERENCES.navMode,
    };
  } catch {
    // Private-mode Safari throws on localStorage access rather than returning
    // null. Preferences are a nicety; never let them break the app.
    return DEFAULT_PREFERENCES;
  }
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences>(readStoredPreferences);

  // The theme and density are expressed as CSS custom properties keyed off
  // these attributes (see index.css), so applying a preference is a single
  // attribute write rather than a re-render of every styled component.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = preferences.theme;
    root.dataset.density = preferences.density;
  }, [preferences.theme, preferences.density]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // Ignore quota/private-mode failures — the session still works.
    }
  }, [preferences]);

  const setPreference = useCallback(
    <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
      setPreferences((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const reset = useCallback(() => setPreferences(DEFAULT_PREFERENCES), []);

  const value = useMemo(
    () => ({ preferences, setPreference, reset }),
    [preferences, setPreference, reset],
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesContextValue {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error("usePreferences must be used within a PreferencesProvider");
  }
  return context;
}
