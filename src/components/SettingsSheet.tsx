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
    <div className="space-y-2">
      <h3 className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground px-1">
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
        "flex flex-col items-start gap-0.5 p-2.5 rounded-lg border transition-all duration-150 text-left active:scale-95",
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border/50 bg-card hover:bg-accent active:bg-accent text-muted-foreground hover:text-foreground",
      )}
    >
      <span className="text-[0.8125rem] font-medium leading-tight">{label}</span>
      <span className="text-[0.6875rem] leading-tight opacity-60">{description}</span>
    </button>
  );
}

export function SettingsSheet() {
  const [open, setOpen] = useState(false);
  const [shownQr, setShownQr] = useState<string | null>(null);
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
        <div className="min-h-full p-4 pt-safe" onClick={closeUnlessOption}>
          <DrawerTitle className="text-base font-semibold text-foreground">
            Customize
          </DrawerTitle>

          {/* Opened back up. Fitting all four groups on one screen was worth
              less than it cost: the groups ran together, and the panel already
              scrolls, so the options below the fold are one flick away rather
              than hidden. */}
          <div className="mt-4 space-y-5">
            {/* Three across, not four: five themes in a four-column grid
                leaves Mono stranded alone on a second row, and the fifth
                column that would fix it squeezes "Matrix" past its label
                width in a drawer this narrow. */}
            <OptionGroup title="Theme" columns={3}>
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
                      "w-5 h-5 rounded-full",
                      colorTheme === opt.value &&
                        "ring-2 ring-offset-2 ring-offset-background ring-primary",
                    )}
                    style={{ background: opt.color }}
                  />
                  <span className="text-[0.6875rem] font-medium">{opt.label}</span>
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

            <p className="px-1 text-[0.6875rem] leading-snug text-muted-foreground">
              Swipe left or right on the list to change day. The colour theme is
              picked at random each time you open the app.
            </p>

            {/* Bottom of the last panel, one line, no illustration and no
                modal. This app is free, has no ads and sells nothing, so a way
                to say thanks belongs somewhere findable — and nowhere else.
                Anything larger would be the first thing in the app asking for
                something rather than offering it.

                The QR is folded away rather than shown, because on the phone
                running this app a QR is the worst of the two paths — you cannot
                scan a code with the camera that is behind it. It is there for
                the other case: showing the screen to someone standing next to
                you. */}
            {DONATE.length > 0 && (
              <div className="border-t border-border/40 px-1 pt-3 pb-safe">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem] text-muted-foreground/70">
                  <span className="flex items-center gap-1.5">
                    <Heart className="h-3 w-3 flex-shrink-0" />
                    Free, no ads.
                  </span>
                  {DONATE.map((target) => (
                    <button
                      key={target.label}
                      type="button"
                      onClick={() =>
                        setShownQr((current) =>
                          current === target.label ? null : target.label,
                        )
                      }
                      aria-expanded={shownQr === target.label}
                      className={cn(
                        "underline decoration-dotted underline-offset-2 transition-colors",
                        shownQr === target.label
                          ? "text-foreground"
                          : "hover:text-foreground",
                      )}
                    >
                      {target.label}
                    </button>
                  ))}
                </div>

                {DONATE.filter((t) => t.label === shownQr).map((target) => (
                  <div
                    key={target.label}
                    className="mt-3 flex flex-col items-center gap-2 rounded-lg border border-border/50 bg-card p-3"
                  >
                    <p className="text-[0.6875rem] text-muted-foreground">
                      Donate via {target.label}
                    </p>
                    {/* Fixed pixel size, not a spacing utility: the spacing
                        scale is density-multiplied here, and a QR that lands on
                        a fractional pixel grid gets soft edges from the
                        browser's resampling. */}
                    <img
                      src={target.qr}
                      alt={`QR code for ${target.url}`}
                      width={144}
                      height={144}
                      className="rounded bg-white"
                      style={{ width: 144, height: 144 }}
                    />
                    <a
                      href={target.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[0.6875rem] text-primary underline underline-offset-2"
                    >
                      {target.url.replace(/^https:\/\//, "")}
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
