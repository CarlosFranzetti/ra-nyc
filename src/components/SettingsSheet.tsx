import { useState } from "react";
import { Heart, Settings } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { useTheme } from "@/context/ThemeContext";
import { DONATE } from "@/lib/donate";
import { cn } from "@/lib/utils";
import {
  DENSITY_OPTIONS,
  TEXT_SIZE_OPTIONS,
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
    <div className="space-y-1.5">
      <h3 className="text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground px-1">
        {title}
      </h3>
      <div
        className={cn(
          "grid gap-1.5",
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
        "flex flex-col items-start p-2 rounded-lg border transition-all duration-150 text-left active:scale-95",
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border/50 bg-card hover:bg-accent active:bg-accent text-muted-foreground hover:text-foreground",
      )}
    >
      <span className="text-[0.8125rem] font-medium leading-tight">{label}</span>
      <span className="text-[0.625rem] leading-tight opacity-60">{description}</span>
    </button>
  );
}

export function SettingsSheet() {
  const [open, setOpen] = useState(false);
  const {
    colorTheme,
    setColorTheme,
    layoutDensity,
    setLayoutDensity,
    typography,
    setTypography,
    textSize,
    setTextSize,
  } = useTheme();

  /**
   * Close on any tap that isn't an option.
   *
   * vaul already dismisses on the overlay, but the panel itself has a lot of
   * dead space — headings, gaps, the padding around the grids — and tapping
   * those felt like the sheet was stuck. Anything that isn't an interactive
   * control now closes it, so there is no way to tap and have nothing happen.
   */
  const closeUnlessOption = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!target.closest("button, a, input, [role='button']")) {
      setOpen(false);
    }
  };

  return (
    <Drawer direction="right" open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <button
          aria-label="Customize"
          className="p-2 rounded-md text-muted-foreground hover:text-foreground active:text-foreground active:scale-95 transition-all"
        >
          <Settings className="w-5 h-5" />
        </button>
      </DrawerTrigger>

      <DrawerContent direction="right" className="overflow-y-auto">
        {/* min-h-full so the dead space below the options is still a close
            target, rather than only the content box being tappable. */}
        <div className="min-h-full p-3 pt-safe" onClick={closeUnlessOption}>
          <DrawerTitle className="text-sm font-semibold text-foreground">
            Customize
          </DrawerTitle>

          {/* Tightened so all four groups plus the footer fit one phone screen.
              A preferences panel you have to scroll hides the options you have
              not thought to look for. */}
          <div className="mt-3 space-y-3">
            <OptionGroup title="Theme" columns={4}>
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setColorTheme(opt.value)}
                  aria-pressed={colorTheme === opt.value}
                  className={cn(
                    "flex flex-col items-center gap-1 p-1.5 rounded-lg border transition-all active:scale-95",
                    colorTheme === opt.value
                      ? "border-primary bg-primary/10"
                      : "border-border/50 bg-card hover:bg-accent",
                  )}
                >
                  <div
                    className={cn(
                      "w-5 h-5 rounded-full",
                      colorTheme === opt.value &&
                        "ring-2 ring-offset-2 ring-offset-background ring-primary",
                    )}
                    style={{ background: opt.color }}
                  />
                  <span className="text-[0.625rem] font-medium">{opt.label}</span>
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

            <OptionGroup title="Text size" columns={3}>
              {TEXT_SIZE_OPTIONS.map((opt) => (
                <OptionButton
                  key={opt.value}
                  active={textSize === opt.value}
                  onClick={() => setTextSize(opt.value)}
                  label={opt.label}
                  description={opt.desc}
                />
              ))}
            </OptionGroup>

            <p className="px-1 text-[0.625rem] leading-snug text-muted-foreground">
              Swipe left or right on the list to change day. The colour theme is
              picked at random each time you open the app.
            </p>

            {/* Bottom of the last panel, one line, no illustration and no
                modal. This app is free, has no ads and sells nothing, so a way
                to say thanks belongs somewhere findable — and nowhere else.
                Anything larger would be the first thing in the app asking for
                something rather than offering it. */}
            {(DONATE.cashApp || DONATE.payPal) && (
              <div className="flex items-center gap-2 border-t border-border/40 px-1 pt-2 pb-safe text-[0.625rem] text-muted-foreground/70">
                <Heart className="h-3 w-3 flex-shrink-0" />
                <span>Free, no ads.</span>
                {DONATE.cashApp && (
                  <a
                    href={DONATE.cashApp}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                  >
                    Cash App
                  </a>
                )}
                {DONATE.payPal && (
                  <a
                    href={DONATE.payPal}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                  >
                    PayPal
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
