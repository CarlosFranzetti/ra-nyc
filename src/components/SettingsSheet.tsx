import { Settings } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";
import {
  DENSITY_OPTIONS,
  NAV_OPTIONS,
  THEME_OPTIONS,
  TYPOGRAPHY_OPTIONS,
} from "@/types/preferences";

function OptionGroup({
  title,
  columns,
  children,
}: {
  title: string;
  columns: 2 | 3 | 4;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
        {title}
      </h3>
      <div
        className={cn(
          "grid gap-2",
          columns === 2 && "grid-cols-2",
          columns === 3 && "grid-cols-3",
          columns === 4 && "grid-cols-4",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function OptionButton({
  active,
  onClick,
  label,
  description,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  description: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex flex-col items-start p-3 rounded-lg border transition-all duration-150 text-left active:scale-95",
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border/50 bg-card hover:bg-accent active:bg-accent text-muted-foreground hover:text-foreground",
      )}
    >
      <span className="text-sm font-medium">{label}</span>
      <span className="text-xs opacity-60 mt-0.5">{description}</span>
    </button>
  );
}

export function SettingsSheet() {
  const {
    colorTheme,
    setColorTheme,
    layoutDensity,
    setLayoutDensity,
    typography,
    setTypography,
    navStyle,
    setNavStyle,
  } = useTheme();

  return (
    <Drawer direction="right">
      <DrawerTrigger asChild>
        <button
          aria-label="Customize"
          className="p-2 rounded-md text-muted-foreground hover:text-foreground active:text-foreground active:scale-95 transition-all"
        >
          <Settings className="w-5 h-5" />
        </button>
      </DrawerTrigger>

      <DrawerContent direction="right" className="overflow-y-auto">
        <div className="p-4 pt-safe">
          <DrawerTitle className="text-base font-semibold text-foreground">
            Customize
          </DrawerTitle>

          <div className="mt-6 space-y-6">
            <OptionGroup title="Theme" columns={4}>
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setColorTheme(opt.value)}
                  aria-pressed={colorTheme === opt.value}
                  className={cn(
                    "flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-all active:scale-95",
                    colorTheme === opt.value
                      ? "border-primary bg-primary/10"
                      : "border-border/50 bg-card hover:bg-accent",
                  )}
                >
                  <div
                    className={cn(
                      "w-6 h-6 rounded-full",
                      colorTheme === opt.value &&
                        "ring-2 ring-offset-2 ring-offset-background ring-primary",
                    )}
                    style={{ background: opt.color }}
                  />
                  <span className="text-[10px] font-medium">{opt.label}</span>
                </button>
              ))}
            </OptionGroup>

            <OptionGroup title="Density" columns={3}>
              {DENSITY_OPTIONS.map((opt) => (
                <OptionButton
                  key={opt.value}
                  active={layoutDensity === opt.value}
                  onClick={() => setLayoutDensity(opt.value)}
                  label={opt.label}
                  description={opt.desc}
                />
              ))}
            </OptionGroup>

            <OptionGroup title="Typography" columns={3}>
              {TYPOGRAPHY_OPTIONS.map((opt) => (
                <OptionButton
                  key={opt.value}
                  active={typography === opt.value}
                  onClick={() => setTypography(opt.value)}
                  label={opt.label}
                  description={opt.desc}
                />
              ))}
            </OptionGroup>

            <OptionGroup title="Navigation" columns={3}>
              {NAV_OPTIONS.map((opt) => (
                <OptionButton
                  key={opt.value}
                  active={navStyle === opt.value}
                  onClick={() => setNavStyle(opt.value)}
                  label={opt.label}
                  description={opt.desc}
                />
              ))}
            </OptionGroup>

            <p className="text-[11px] text-muted-foreground px-1">
              Swipe left or right on the list to change day. The colour theme is
              picked at random each time you open the app.
            </p>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
