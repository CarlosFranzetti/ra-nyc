import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { CalendarDays, Search } from "lucide-react";
import { DividedBoxes } from "@/components/DividedBoxes";
import { NO_TAPS, tap, type TapState } from "@/lib/secretTaps";
import { cn } from "@/lib/utils";

// react-day-picker is the heaviest dependency in the app and the calendar is
// opened rarely, so it loads on demand.
const CalendarPopover = lazy(() =>
  import("@/components/CalendarPopover").then((m) => ({
    default: m.CalendarPopover,
  })),
);
import { SettingsSheet } from "@/components/SettingsSheet";

interface HeaderProps {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  onSearchClick: () => void;
  /** How many events the current filters leave, for the caption to alternate to. */
  eventCount: number;
}

/** How long each face of the caption holds before it swaps. */
const CAPTION_HOLD_MS = 6_000;

/**
 * Is this a phone?
 *
 * `pointer: coarse` rather than a width breakpoint: the hidden screen is a
 * touch toy — it is unlocked by tapping a logo seventeen times and driven by
 * swiping up and down — and none of that is a thing anybody does with a mouse.
 * A narrow desktop window is still a desktop.
 *
 * Read once, outside the component: it is a property of the device, and
 * re-evaluating it per render would be a media query per render for an answer
 * that cannot change.
 */
const IS_TOUCH =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;

export function Header({
  selectedDate,
  onDateChange,
  onSearchClick,
  eventCount,
}: HeaderProps) {
  /**
   * The hidden screen: open Customize, close it, then tap the logo seventeen
   * times in a row. Nothing announces it and nothing counts down.
   *
   * Both halves are refs rather than state on purpose. Sixteen of every
   * seventeen taps change nothing anyone can see, and putting the counter in
   * state would re-render the header — and every date chip under it — once per
   * tap, to display the same thing. The one tap that matters flips `secret`,
   * which is state, because that one does change the screen.
   */
  const armed = useRef(false);
  const taps = useRef<TapState>(NO_TAPS);
  const [secret, setSecret] = useState(false);

  const onLogoTap = () => {
    // Phones only. Checked here rather than by hiding the trigger, because the
    // trigger is the logo and the logo is not going anywhere.
    if (!IS_TOUCH) return;
    const result = tap(taps.current, armed.current, Date.now());
    taps.current = result.state;
    if (result.unlocked) {
      // Disarm on the way in, so leaving the screen and tapping the logo again
      // does not reopen it without going back through Customize.
      armed.current = false;
      setSecret(true);
    }
  };

  /**
   * The caption alternates between the date and the night's size.
   *
   * Both are answers to "what am I looking at", and there is one slot in the
   * middle of the header for them. Swapping on a timer means neither has to be
   * given up and neither costs a row: the count used to sit in the filter row,
   * where it was a number with no label competing with three chips.
   *
   * A tap swaps immediately and restarts the clock, so it is also a control —
   * you never have to wait out a hold to see the other one.
   */
  const [showCount, setShowCount] = useState(false);
  useEffect(() => {
    // Nothing to alternate with until the day has loaded.
    if (eventCount <= 0) {
      setShowCount(false);
      return undefined;
    }
    const timer = setInterval(
      () => setShowCount((current) => !current),
      CAPTION_HOLD_MS,
    );
    return () => clearInterval(timer);
    // `showCount` deliberately absent: including it would clear and re-arm the
    // interval on every swap, which is a new full-length hold each time and
    // works — but a tap would then also silently restart it, and the reset is
    // handled explicitly below so it is visible where it happens.
  }, [eventCount]);

  const caption = showCount
    ? `${eventCount} event${eventCount !== 1 ? "s" : ""}`
    : format(selectedDate, "EEE, MMM d");

  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-lg border-b border-border/50 pt-safe">
      {/* py in literal px, not the density-scaled scale.
          Every other gap in the app answers to the Density preference, and this
          one deliberately does not: the logo row is a fixed mark and a row of
          icons, so there is nothing in it that reads better with more air. On
          Airy it was taking 22px above the wordmark — a quarter of the header —
          to separate a title from a browser toolbar it is already separated
          from. Small and constant is the whole requirement. */}
      <div className="shell relative flex items-center justify-between px-4 py-[5px]">
        {/* A logo, not a heading — so it is deliberately outside every
            preference axis. It used to inherit the `type-*` class from <html>,
            which meant the app's own name was rendered in whichever typeface
            you last picked and the one fixed point on the screen moved with the
            settings. `.logo` pins the family, the weight and the colour in
            plain CSS (see index.css), and the colour is a literal near-white
            rather than --foreground, which is tinted per theme.

            The mark echoes the home-screen icon exactly: RA in a filled block,
            same typeface, same weight. */}
        {/* The tap target for the sequence above. No role, no aria-label and
            no hover state: an easter egg that advertises itself is a feature.
            Nothing about the logo's behaviour changes for anyone not counting —
            it was inert before and it still looks inert. */}
        <h1 className="logo flex items-center gap-2" onClick={onLogoTap}>
          <span className="logo-mark">RA</span>
          <span className="logo-word">NYC</span>
        </h1>

        {/* The night you are looking at, in the middle of the header.
            It used to be a caption on its own line above the date rail, which
            cost a full row of vertical space to say eleven characters. Up here
            it costs nothing: the header row is as tall as its icons whether or
            not there is anything between them.

            Absolutely centred rather than a flex child, and the difference is
            visible. The wordmark and the icon cluster are not the same width,
            so a `flex-1 text-center` middle lands the date at the centre of
            *what is left*, which sits noticeably right of the screen's centre.
            This is the actual middle.

            A button, not a span: it swaps the two captions on demand. It is
            still `absolute` and still narrow, so it does not eat the logo's tap
            target — which matters, because that target is counting to
            seventeen. */}
        <button
          type="button"
          onClick={() => {
            setShowCount((current) => !current);
          }}
          aria-live="polite"
          aria-label={`${caption}. Tap to switch between the date and the number of events.`}
          className="absolute left-1/2 -translate-x-1/2 rounded px-2 py-0.5 text-xs font-semibold text-primary"
        >
          {/* Keyed on the text so React remounts the span on every swap, which
              is what restarts the fade — a plain text change would swap the
              characters with no transition to animate. */}
          <span key={caption} className={cn("block", "caption-swap")}>
            {caption}
          </span>
        </button>

        <div className="flex items-center gap-1">
          {/* Left of the calendar. A button rather than an inline field: at this
              width a real input would crowd out the title, and the search needs
              a full sheet to show results in anyway. */}
          <button
            onClick={onSearchClick}
            aria-label="Search events"
            className="p-[5px] rounded-md text-muted-foreground hover:text-foreground active:text-foreground active:scale-95 transition-all"
          >
            <Search className="h-[20px] w-[20px]" />
          </button>
          <Suspense
            fallback={
              <span className="p-2 text-muted-foreground">
                <CalendarDays className="h-[20px] w-[20px]" />
              </span>
            }
          >
            <CalendarPopover
              selectedDate={selectedDate}
              onDateChange={onDateChange}
            />
          </Suspense>
          {/* Arming happens on *close*, not on open, which is what makes the
              sequence a sequence: the panel has to have been opened and
              dismissed before the taps count for anything. Opening it again
              clears any run in progress. */}
          <SettingsSheet
            onOpenChange={(open) => {
              armed.current = !open;
              if (open) taps.current = NO_TAPS;
            }}
          />
        </div>
      </div>

      {secret && <DividedBoxes onExit={() => setSecret(false)} />}
    </header>
  );
}
