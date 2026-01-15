import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export type ColorTheme = "neon" | "vapor" | "matrix" | "sunset";
export type LayoutDensity = "default" | "tight" | "airy";
export type Typography = "system" | "mono" | "display";
export type NavStyle = "standard" | "tabs" | "minimal";

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

const colorThemes: ColorTheme[] = ["neon", "vapor", "matrix", "sunset"];

const getRandomColorTheme = (): ColorTheme => {
  return colorThemes[Math.floor(Math.random() * colorThemes.length)];
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ThemeSettings>(() => {
    const saved = localStorage.getItem("ra-theme-settings");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const validDensity = ["default", "tight", "airy"];
        const validTypo = ["system", "mono", "display"];
        const validNav = ["standard", "tabs", "minimal"];
        
        // Always pick a random color theme on startup
        return {
          colorTheme: getRandomColorTheme(),
          layoutDensity: validDensity.includes(parsed.layoutDensity) ? parsed.layoutDensity : "default",
          typography: validTypo.includes(parsed.typography) ? parsed.typography : "system",
          navStyle: validNav.includes(parsed.navStyle) ? parsed.navStyle : "standard",
        };
      } catch {
        return {
          colorTheme: getRandomColorTheme(),
          layoutDensity: "default",
          typography: "system",
          navStyle: "standard",
        };
      }
    }
    return {
      colorTheme: getRandomColorTheme(),
      layoutDensity: "default",
      typography: "system",
      navStyle: "standard",
    };
  });

  useEffect(() => {
    localStorage.setItem("ra-theme-settings", JSON.stringify(settings));
    
    const root = document.documentElement;
    
    // Color theme
    root.classList.remove("theme-neon", "theme-vapor", "theme-matrix", "theme-sunset");
    root.classList.add(`theme-${settings.colorTheme}`);
    
    // Layout density
    root.classList.remove("density-default", "density-tight", "density-airy");
    root.classList.add(`density-${settings.layoutDensity}`);
    
    // Typography
    root.classList.remove("font-system", "font-mono", "font-display");
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
