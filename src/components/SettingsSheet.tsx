import Sheet from "@/components/Sheet";
import { usePreferences } from "@/context/PreferencesContext";
import { cn } from "@/lib/utils";
import {
  COLOR_THEMES,
  DENSITIES,
  DENSITY_LABELS,
  NAV_MODES,
  NAV_MODE_HINTS,
  NAV_MODE_LABELS,
  THEME_LABELS,
  THEME_SWATCHES,
} from "@/types/preferences";

interface SettingsSheetProps {
  open: boolean;
  onClose: () => void;
}

function SectionHeading({ children }: { children: string }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
      {children}
    </h3>
  );
}

const optionClasses = (selected: boolean) =>
  cn(
    "rounded-md border px-3 py-2 text-xs transition-all duration-150 active:scale-95",
    selected
      ? "bg-primary text-primary-foreground border-primary font-medium"
      : "bg-secondary text-foreground border-border hover:bg-accent active:bg-accent",
  );

export default function SettingsSheet({ open, onClose }: SettingsSheetProps) {
  const { preferences, setPreference, reset } = usePreferences();

  return (
    <Sheet open={open} onClose={onClose} title="Preferences">
      <div className="space-y-5">
        <section>
          <SectionHeading>Theme</SectionHeading>
          <div className="grid grid-cols-2 gap-2">
            {COLOR_THEMES.map((theme) => {
              const [surface, accent] = THEME_SWATCHES[theme];
              return (
                <button
                  key={theme}
                  type="button"
                  onClick={() => setPreference("theme", theme)}
                  aria-pressed={preferences.theme === theme}
                  className={cn(
                    optionClasses(preferences.theme === theme),
                    "flex items-center gap-2",
                  )}
                >
                  {/* Preview the palette rather than only naming it — the names
                      mean nothing until you've seen them. */}
                  <span
                    className="h-4 w-4 shrink-0 rounded-full border border-white/20"
                    style={{
                      background: `linear-gradient(135deg, ${surface} 50%, ${accent} 50%)`,
                    }}
                  />
                  {THEME_LABELS[theme]}
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <SectionHeading>Density</SectionHeading>
          <div className="grid grid-cols-3 gap-2">
            {DENSITIES.map((density) => (
              <button
                key={density}
                type="button"
                onClick={() => setPreference("density", density)}
                aria-pressed={preferences.density === density}
                className={optionClasses(preferences.density === density)}
              >
                {DENSITY_LABELS[density]}
              </button>
            ))}
          </div>
        </section>

        <section>
          <SectionHeading>Navigation</SectionHeading>
          <div className="space-y-2">
            {NAV_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setPreference("navMode", mode)}
                aria-pressed={preferences.navMode === mode}
                className={cn(
                  optionClasses(preferences.navMode === mode),
                  "w-full text-left",
                )}
              >
                <span className="block font-medium">{NAV_MODE_LABELS[mode]}</span>
                <span
                  className={cn(
                    "block text-[11px]",
                    preferences.navMode === mode
                      ? "opacity-70"
                      : "text-muted-foreground",
                  )}
                >
                  {NAV_MODE_HINTS[mode]}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Swipe left or right anywhere on the list to change day in any mode.
          </p>
        </section>

        <button
          type="button"
          onClick={reset}
          className="text-xs text-muted-foreground hover:text-foreground active:text-foreground underline underline-offset-2"
        >
          Reset to defaults
        </button>
      </div>
    </Sheet>
  );
}
