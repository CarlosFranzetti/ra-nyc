import { lazy, Suspense, useRef, useState } from "react";
import { CalendarDays, Search } from "lucide-react";
import { DividedBoxes } from "@/components/DividedBoxes";
import { NO_TAPS, tap, type TapState } from "@/lib/secretTaps";

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
}

export function Header({ selectedDate, onDateChange, onSearchClick }: HeaderProps) {
  /**
   * The hidden screen: open Customize, close it, then tap the logo twenty-six
   * times in a row. Nothing announces it and nothing counts down.
   *
   * Both halves are refs rather than state on purpose. Twenty-five of every
   * twenty-six taps change nothing anyone can see, and putting the counter in
   * state would re-render the header — and every date chip under it — once per
   * tap, to display the same thing. The one tap that matters flips `secret`,
   * which is state, because that one does change the screen.
   */
  const armed = useRef(false);
  const taps = useRef<TapState>(NO_TAPS);
  const [secret, setSecret] = useState(false);

  const onLogoTap = () => {
    const result = tap(taps.current, armed.current, Date.now());
    taps.current = result.state;
    if (result.unlocked) {
      // Disarm on the way in, so leaving the screen and tapping the logo again
      // does not reopen it without going back through Customize.
      armed.current = false;
      setSecret(true);
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-lg border-b border-border/50 pt-safe">
      <div className="shell px-4 py-4 flex items-center justify-between">
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
          <span className="logo-word">NYC Events</span>
        </h1>
        <div className="flex items-center gap-1">
          {/* Left of the calendar. A button rather than an inline field: at this
              width a real input would crowd out the title, and the search needs
              a full sheet to show results in anyway. */}
          <button
            onClick={onSearchClick}
            aria-label="Search events"
            className="p-2 rounded-md text-muted-foreground hover:text-foreground active:text-foreground active:scale-95 transition-all"
          >
            <Search className="w-5 h-5" />
          </button>
          <Suspense
            fallback={
              <span className="p-2 text-muted-foreground">
                <CalendarDays className="h-5 w-5" />
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
