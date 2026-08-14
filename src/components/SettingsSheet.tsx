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
  TEXT_SIZES,
  THEME_OPTIONS,
  TYPOGRAPHY_OPTIONS,
} from "@/types/preferences";

function OptionGroup({
  title,
  columns,
  children,
}: {
  title: string;
  columns: 1 | 2 | 3 | 4 | 5;
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
          columns === 1 && "grid-cols-1",
          columns === 2 && "grid-cols-2",
          columns === 3 && "grid-cols-3",
          columns === 4 && "grid-cols-4",
          columns === 5 && "grid-cols-5 gap-1",
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
  labelClassName,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  description: string;
  labelClassName?: string;
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
      <span className={cn("text-[0.8125rem] font-medium leading-tight", labelClassName)}>
        {label}
      </span>
      <span className="text-[0.6875rem] leading-tight opacity-60">{description}</span>
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

  // Position on the ladder, which is what the slider moves — the stored value
  // is the label on the rung, not the rung. A range input only speaks numbers,
  // so this is also the conversion in both directions.
  const sizeIndex = Math.max(0, TEXT_SIZES.indexOf(textSize));

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
            {/* One row. The drawer is 320px, so five cells with a 4px gutter
                land at ~52px each — enough for a 20px swatch and "Matrix" at
                10px, which is why that group alone drops a step in gap and
                type. Seeing all five side by side is worth more than the two
                points of label size it costs. */}
            <OptionGroup title="Theme" columns={5}>
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setColorTheme(opt.value)}
                  aria-pressed={colorTheme === opt.value}
                  className={cn(
                    "flex flex-col items-center gap-1.5 px-0.5 py-2 rounded-lg border transition-all active:scale-95",
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

            {/* Each option's label is set in the face it selects. A font picker
                that names three fonts in a fourth font is asking you to take
                its word for it. */}
            <OptionGroup title="Typography" columns={3}>
              {TYPOGRAPHY_OPTIONS.map((opt) => (
                <OptionButton
                  key={opt.value}
                  active={typography === opt.value}
                  onClick={() => setTypography(opt.value)}
                  label={opt.label}
                  description={opt.desc}
                  labelClassName={cn(opt.className, "type-headline")}
                />
              ))}
            </OptionGroup>

            {/* A slider, not a stepper and not six buttons.

                The stepper this replaces was two taps away from either end of
                a six-rung ladder and gave no way to say "that one" — you had
                to walk there. A range input drags, and a tap anywhere on the
                track jumps to the nearest rung, so both readings of "pick a
                size" work with one control.

                The +/- buttons went with it rather than sitting alongside.
                They were 80px of a 320px drawer doing what an arrow key and a
                drag already do, and the room they gave back is what makes the
                track long enough that six rungs are far enough apart to hit.

                The two A's are the scale, not decoration — they are set at the
                sizes the ends of the ladder actually produce, in px, so they
                stay put while everything between them moves. */}
            <OptionGroup title="Text size" columns={1}>
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="flex-shrink-0 font-semibold leading-none text-muted-foreground"
                  style={{ fontSize: 11 }}
                >
                  A
                </span>

                {/* data-vaul-no-drag, or a left-to-right drag on the slider is
                    also a left-to-right drag on a right-hand drawer, and vaul
                    reads it as "dismiss me" — so raising the text size would
                    close the panel you raised it from. */}
                <div className="relative h-7 flex-1" data-vaul-no-drag>
                  {/* Inset by half a thumb at each end: a range thumb's centre
                      travels from 10px to width-10px, never to the very edge,
                      so ticks laid out across the full width would drift out
                      of line with it — worst at the two ends, which are the
                      two positions people check. */}
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 left-[10px] right-[10px]"
                  >
                    <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-secondary" />
                    <div
                      className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary"
                      style={{ width: `${(sizeIndex / (TEXT_SIZES.length - 1)) * 100}%` }}
                    />
                    {TEXT_SIZES.map((value, i) => (
                      <span
                        key={value}
                        className={cn(
                          "absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full",
                          i <= sizeIndex ? "bg-primary-foreground/60" : "bg-muted-foreground/50",
                        )}
                        style={{ left: `${(i / (TEXT_SIZES.length - 1)) * 100}%` }}
                      />
                    ))}
                  </div>

                  <input
                    type="range"
                    min={0}
                    max={TEXT_SIZES.length - 1}
                    step={1}
                    value={sizeIndex}
                    onChange={(event) =>
                      setTextSize(TEXT_SIZES[Number(event.target.value)]!)
                    }
                    aria-label="Text size"
                    // The stored values are "0".."5", which read as sizes in
                    // pixels or points to anything speaking them aloud. This
                    // says where you are on the ladder instead.
                    aria-valuetext={`Size ${sizeIndex + 1} of ${TEXT_SIZES.length}`}
                    className="size-slider absolute inset-0 w-full"
                  />
                </div>

                <span
                  aria-hidden
                  className="flex-shrink-0 font-semibold leading-none text-muted-foreground"
                  style={{ fontSize: 21 }}
                >
                  A
                </span>
              </div>
            </OptionGroup>

            <p className="px-1 text-[0.6875rem] leading-snug text-muted-foreground">
              Swipe the list left or right to change day. The colour theme is
              random each time you open the app.
            </p>

            {/* Bottom of the last panel, one line, no illustration and no
                modal. This app is free, has no ads and sells nothing, so a way
                to say thanks belongs somewhere findable — and nowhere else.
                Anything larger would be the first thing in the app asking for
                something rather than offering it.

                Plain links, straight out. The QR that used to live here was
                solving a problem nobody had: on the phone running this app you
                cannot scan a code with the camera behind it, so every tap was
                a detour through a picture on the way to the link underneath. */}
            {DONATE.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/40 px-1 pt-3 pb-safe text-sm">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
                  <Heart className="h-3.5 w-3.5 flex-shrink-0" />
                  Free, no ads.
                </span>
                {/* Bigger and bold than the caption beside them, because they
                    are the only two things in this panel that are a decision
                    rather than a setting — everything else here you can fiddle
                    with and undo. */}
                {DONATE.map((target) => (
                  <a
                    key={target.label}
                    href={target.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-bold text-foreground underline decoration-dotted underline-offset-2 transition-colors hover:text-primary"
                  >
                    {target.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
