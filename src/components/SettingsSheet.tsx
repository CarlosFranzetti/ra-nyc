import { useState } from "react";
import { Heart, RotateCcw, Settings, Shuffle } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { useTheme } from "@/context/ThemeContext";
import { hostOf, outbound } from "@/lib/analytics";
import { DONATE } from "@/lib/donate";
import { cn } from "@/lib/utils";
import {
  CORNERS,
  DENSITY_OPTIONS,
  FACE_OPTIONS,
  GLOWS,
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

/**
 * A range input over a short ordered list, drawn as a track with one tick per
 * value.
 *
 * Shared by Text size and Typography because they are the same control twice:
 * an axis with a handful of stops where you want both "one more" and "that
 * one". Everything visible is markup underneath a transparent native input —
 * see `.size-slider` in index.css for why the track is not painted through the
 * element's own pseudo-elements, and why the fill and ticks are inset 10px.
 */
function StepSlider({
  label,
  count,
  index,
  onChange,
  valueText,
}: {
  label: string;
  count: number;
  index: number;
  onChange: (next: number) => void;
  valueText: string;
}) {
  const pct = (i: number) => (count > 1 ? (i / (count - 1)) * 100 : 0);

  return (
    /* data-vaul-no-drag, or a left-to-right drag on the slider is also a
       left-to-right drag on a right-hand drawer, and vaul reads it as "dismiss
       me" — so raising a setting would close the panel you raised it from. */
    <div className="relative h-7 flex-1" data-vaul-no-drag>
      {/* Inset by half a thumb at each end: a range thumb's centre travels from
          10px to width-10px, never to the very edge, so ticks laid out across
          the full width would drift out of line with it — worst at the two
          ends, which are the two positions people check. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-[10px] right-[10px]"
      >
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-secondary" />
        <div
          className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary"
          style={{ width: `${pct(index)}%` }}
        />
        {Array.from({ length: count }, (_, i) => (
          <span
            key={i}
            className={cn(
              "absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full",
              i <= index ? "bg-primary-foreground/60" : "bg-muted-foreground/50",
            )}
            style={{ left: `${pct(i)}%` }}
          />
        ))}
      </div>

      <input
        type="range"
        min={0}
        max={count - 1}
        step={1}
        value={index}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
        // The stored values are "0".."5" and "system"/"legible"/"condensed",
        // neither of which reads as a position when spoken aloud.
        aria-valuetext={valueText}
        className="size-slider absolute inset-0 w-full"
      />
    </div>
  );
}


function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-foreground">{children}</span>
      <span className="h-px flex-1 bg-border/60" />
    </div>
  );
}

/** One 44px segment. Labels stay in the UI face, so the row never changes size with the setting. */
function Seg({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "h-[44px] rounded-lg border text-[0.75rem] font-medium transition-all active:scale-95",
        on ? "border-primary bg-primary/10 text-primary" : "border-border/50 bg-card text-muted-foreground hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

/** A real event row, built from the same classes as EventCard, living inside the sheet — so it wears every choice made below it. */
function PreviewCard() {
  return (
    <div className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 pb-2 pt-1 backdrop-blur">
      <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-card p-2 glow-primary-sm">
        <div className="relative h-[64px] w-[64px] flex-shrink-0 overflow-hidden rounded-md" style={{ background: "linear-gradient(135deg, hsl(var(--primary)/.85), hsl(var(--venue)/.7))" }}>
          <div className="absolute left-1 top-1 rounded bg-primary px-1.5 py-0.5 text-[0.5625rem] font-semibold text-primary-foreground">PICK</div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-[0.25rem]">
          <h3 className="type-headline text-sm font-semibold leading-tight text-foreground">Warehouse Session</h3>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-semibold text-venue">Nowadays</span>
            <span>10:00 PM</span>
          </div>
          <p className="text-[0.6875rem] text-muted-foreground">Objekt · Nina Kraviz</p>
        </div>
      </div>
    </div>
  );
}

/**
 * `onOpenChange` exists for one caller and one reason: the header watches this
 * panel closing, because that is the first half of the logo's unlock sequence.
 * Optional, so nothing else has to care.
 */
export function SettingsSheet({
  onOpenChange,
}: {
  onOpenChange?: (open: boolean) => void;
} = {}) {
  const [open, setOpenState] = useState(false);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const {
    colorTheme,
    setColorTheme,
    layoutDensity,
    setLayoutDensity,
    typography,
    setTypography,
    textSize,
    setTextSize,
    face,
    setFace,
    glow,
    setGlow,
    corners,
    setCorners,
    themePinned,
    setThemePinned,
    surprise,
    reset,
  } = useTheme();

  // Position on the ladder, which is what the slider moves — the stored value
  // is the label on the rung, not the rung. A range input only speaks numbers,
  // so this is also the conversion in both directions.
  const sizeIndex = Math.max(0, TEXT_SIZES.indexOf(textSize));
  const fontIndex = Math.max(
    0,
    TYPOGRAPHY_OPTIONS.findIndex((option) => option.value === typography),
  );
  const densityIndex = Math.max(
    0,
    DENSITY_OPTIONS.findIndex((option) => option.value === layoutDensity),
  );

  /**
   * Close on a tap outside the controls.
   *
   * vaul already dismisses on the overlay, but the panel has dead space below
   * the options and tapping it felt like the sheet was stuck, so that space
   * closes too.
   *
   * The rule used to be "anything that is not a button, link or input", and
   * that was too narrow once two of the settings became sliders. A slider is
   * surrounded by things that are none of those — its own padding, the tick
   * row, the letters flanking it, the gap before the next group — and a finger
   * leaving the track a few pixels high after a drag landed on one of them. The
   * panel closed while you were still adjusting, which is what "it closes as
   * soon as I set the size" was describing.
   *
   * The whole options block is now one interactive region: tapping inside it
   * adjusts something or does nothing, and closing takes a deliberate tap past
   * the end of it.
   */
  const closeUnlessOption = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!target.closest("[data-controls], button, a, input, [role='button']")) {
      setOpen(false);
    }
  };

  // No background scale on this one. A right-hand panel is a *push*, not a
  // presentation — on iOS the screen behind a push slides, it does not recede —
  // so scaling the page here would be borrowing the wrong idiom for the
  // gesture.
  return (
    <Drawer direction="right" open={open} onOpenChange={setOpen} scaleBackground={false}>
      <DrawerTrigger asChild>
        <button
          aria-label="Customize"
          className="tap rounded-md text-muted-foreground hover:text-foreground active:text-foreground active:scale-95 transition-all"
        >
          <Settings className="h-[20px] w-[20px]" />
        </button>
      </DrawerTrigger>

      <DrawerContent direction="right" className="overflow-y-auto">
        {/* min-h-full so the dead space below the options is still a close
            target, rather than only the content box being tappable. */}
        <div className="min-h-full p-4 pt-safe" onClick={closeUnlessOption}>
          <DrawerTitle className="text-base font-semibold text-foreground">
            Customize
          </DrawerTitle>

          {/* data-controls marks the whole block as interactive, so a tap that
              lands in the gaps around a slider adjusts nothing rather than
              dismissing the panel. See closeUnlessOption. */}
          <div data-controls className="mt-3 space-y-5">
            <PreviewCard />

            <SectionHead>Look</SectionHead>
            <OptionGroup title="Theme" columns={4}>
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

            <button
              type="button"
              role="switch"
              aria-checked={themePinned}
              onClick={() => setThemePinned(!themePinned)}
              className="flex h-[44px] w-full items-center justify-between rounded-lg border border-border/50 bg-card px-3 text-left text-[0.8125rem] transition-all active:scale-[0.99]"
            >
              <span>Keep this theme next time</span>
              <span className={cn("relative h-[22px] w-[38px] rounded-full transition-colors", themePinned ? "bg-primary" : "bg-secondary")}>
                <span className={cn("absolute top-[3px] h-4 w-4 rounded-full bg-foreground transition-all", themePinned ? "left-[19px] bg-primary-foreground" : "left-[3px]")} />
              </span>
            </button>

            <OptionGroup title="Glow" columns={3}>
              {GLOWS.map((g) => (
                <Seg key={g} on={glow === g} onClick={() => setGlow(g)}>{g === "soft" ? "Soft" : g === "off" ? "Off" : "Full"}</Seg>
              ))}
            </OptionGroup>
            <OptionGroup title="Corners" columns={3}>
              {CORNERS.map((c) => (
                <Seg key={c} on={corners === c} onClick={() => setCorners(c)}>{c === "soft" ? "Soft" : c === "sharp" ? "Sharp" : "Round"}</Seg>
              ))}
            </OptionGroup>

            <SectionHead>Type</SectionHead>
            <OptionGroup title="Typography" columns={1}>
              <StepSlider
                label="Typography"
                count={TYPOGRAPHY_OPTIONS.length}
                index={fontIndex}
                onChange={(next) => setTypography(TYPOGRAPHY_OPTIONS[next]!.value)}
                valueText={TYPOGRAPHY_OPTIONS[fontIndex]!.label}
              />
              <div className="flex items-start justify-between gap-1 px-0.5">
                {TYPOGRAPHY_OPTIONS.map((opt, i) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setTypography(opt.value)}
                    aria-pressed={typography === opt.value}
                    className={cn(
                      // The ends anchor to their own tick rather than centring,
                      // which would push "System" left of where the track starts
                      // and "Condensed" past where it ends.
                      "min-w-0 flex-1 text-[0.6875rem] leading-tight transition-colors",
                      i === 0 && "text-left",
                      i === TYPOGRAPHY_OPTIONS.length - 1 && "text-right",
                      i > 0 && i < TYPOGRAPHY_OPTIONS.length - 1 && "text-center",
                      typography === opt.value
                        ? "font-semibold text-primary"
                        : "text-muted-foreground",
                    )}
                  >
                    <span className={cn(opt.className, "type-headline")}>{opt.label}</span>
                  </button>
                ))}
              </div>
            </OptionGroup>

            <OptionGroup title="Typeface" columns={3}>
              {FACE_OPTIONS.map((o) => (
                <Seg key={o.value} on={face === o.value} onClick={() => setFace(o.value)}>{o.label}</Seg>
              ))}
            </OptionGroup>
            <OptionGroup title="Text size" columns={1}>
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="flex-shrink-0 font-semibold leading-none text-muted-foreground"
                  style={{ fontSize: 11 }}
                >
                  A
                </span>

                <StepSlider
                  label="Text size"
                  count={TEXT_SIZES.length}
                  index={sizeIndex}
                  onChange={(next) => setTextSize(TEXT_SIZES[next]!)}
                  valueText={`Size ${sizeIndex + 1} of ${TEXT_SIZES.length}`}
                />

                <span
                  aria-hidden
                  className="flex-shrink-0 font-semibold leading-none text-muted-foreground"
                  style={{ fontSize: 21 }}
                >
                  A
                </span>
              </div>
            </OptionGroup>

            <SectionHead>Space</SectionHead>
            <OptionGroup title="Density" columns={1}>
              <StepSlider
                label="Density"
                count={DENSITY_OPTIONS.length}
                index={densityIndex}
                onChange={(next) => setLayoutDensity(DENSITY_OPTIONS[next]!.value)}
                valueText={DENSITY_OPTIONS[densityIndex]!.label}
              />
              <div className="flex items-start justify-between gap-1 px-0.5">
                {DENSITY_OPTIONS.map((opt, i) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setLayoutDensity(opt.value)}
                    aria-pressed={layoutDensity === opt.value}
                    className={cn(
                      // Ends anchor to their own tick rather than centring,
                      // which would push "Tight" left of where the track starts.
                      "min-w-0 flex-1 text-[0.6875rem] leading-tight transition-colors",
                      i === 0 && "text-left",
                      i === DENSITY_OPTIONS.length - 1 && "text-right",
                      i > 0 && i < DENSITY_OPTIONS.length - 1 && "text-center",
                      layoutDensity === opt.value
                        ? "font-semibold text-primary"
                        : "text-muted-foreground",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </OptionGroup>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button type="button" onClick={surprise} className="flex h-[44px] items-center justify-center gap-2 rounded-lg border border-primary/60 bg-primary/10 text-[0.8125rem] font-semibold text-primary transition-all active:scale-95">
                <Shuffle className="h-4 w-4" /> Surprise me
              </button>
              <button type="button" onClick={reset} className="flex h-[44px] items-center justify-center gap-2 rounded-lg border border-border/50 bg-card text-[0.8125rem] text-muted-foreground transition-all active:scale-95">
                <RotateCcw className="h-4 w-4" /> Reset
              </button>
            </div>

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
                    onClick={() =>
                      outbound("donate", { host: hostOf(target.url) })
                    }
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
