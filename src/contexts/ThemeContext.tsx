import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export type ColorTheme = "monochrome" | "neon" | "warm" | "light";
export type LayoutDensity = "compact" | "ultra-compact" | "relaxed";
export type Typography = "default" | "techno" | "editorial";
export type NavStyle = "default" | "bottom-nav" | "swipe" | "fab";

interface ThemeSettings {
  colorTheme: ColorTheme;
  layoutDensity: LayoutDensity;
  typography: Typography;
  navStyle: NavStyle;
}

interface ThemeContextType extends ThemeSettings {
  setColorTheme: (theme: ColorTheme) => void;
  setLayoutDensity: (density: LayoutDensity) => void;
  setTypography: (typography: Typography) => void;
  setNavStyle: (style: NavStyle) => void;
}

const defaultSettings: ThemeSettings = {
  colorTheme: "monochrome",
  layoutDensity: "compact",
  typography: "default",
  navStyle: "default",
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ThemeSettings>(() => {
    const saved = localStorage.getItem("ra-theme-settings");
    return saved ? JSON.parse(saved) : defaultSettings;
  });

  useEffect(() => {
    localStorage.setItem("ra-theme-settings", JSON.stringify(settings));
    
    // Apply classes to root
    const root = document.documentElement;
    
    // Color theme
    root.classList.remove("theme-monochrome", "theme-neon", "theme-warm", "theme-light");
    root.classList.add(`theme-${settings.colorTheme}`);
    
    // Layout density
    root.classList.remove("density-compact", "density-ultra-compact", "density-relaxed");
    root.classList.add(`density-${settings.layoutDensity}`);
    
    // Typography
    root.classList.remove("font-default", "font-techno", "font-editorial");
    root.classList.add(`font-${settings.typography}`);
  }, [settings]);

  const value: ThemeContextType = {
    ...settings,
    setColorTheme: (colorTheme) => setSettings((s) => ({ ...s, colorTheme })),
    setLayoutDensity: (layoutDensity) => setSettings((s) => ({ ...s, layoutDensity })),
    setTypography: (typography) => setSettings((s) => ({ ...s, typography })),
    setNavStyle: (navStyle) => setSettings((s) => ({ ...s, navStyle })),
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
