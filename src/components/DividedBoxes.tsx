import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, X } from "lucide-react";

/**
 * How many rows the screen can be divided into.
 *
 * A narrow band on purpose. The original ran 1–20, which meant most of the
 * range was a handful of tall boxes and only the far end looked like anything.
 * 18–25 is the part that was worth keeping: dense enough that the dotted rules
 * read as a texture rather than as boxes, and narrow enough that the whole
 * range is reachable in one thumb-swipe.
 */
const MIN = 18;
const MAX = 25;

/** Where it opens. The middle of the band, so both directions are available. */
const START = 21;

/** Pixels of vertical drag per step. */
const DRAG_STEP_PX = 26;

/**
 * The hidden screen.
 *
 * Reached by opening Customize, closing it, and tapping the logo seventeen
 * times in a row. Phones only — see `IS_TOUCH` in Header. Undocumented on
 * purpose: it is not in the settings, not in the README, and nothing on screen
 * hints at it.
 *
 * Everything here comes from the same tokens the rest of the app uses, which is
 * the whole reason it can live in this codebase — a greyscale panel with an
 * amber counter would look like a different app pasted in, and this way it
 * takes whichever theme you happen to be on.
 *
 * There are no numbers anywhere on it. The original showed a count in the
 * header and an index inside every box, which made it read as a debug view of
 * something. Without them it is just the thing itself.
 *
 * Rendered through a portal into `document.body`, which is not optional:
 * `position: fixed` is contained by any ancestor with a `backdrop-filter`, and
 * the header this is triggered from has one. Rendered in place, a fixed
 * full-screen overlay would be trapped inside the header's own box.
 */
export function DividedBoxes({ onExit }: { onExit: () => void }) {
  const [count, setCount] = useState(START);

  const add = () => setCount((c) => Math.min(MAX, c + 1));
  const remove = () => setCount((c) => Math.max(MIN, c - 1));

  /**
   * Dragging up and down changes the division too.
   *
   * The buttons are the discoverable way and this is the one that feels like
   * the toy. Tracked against the position the last step was taken at rather
   * than against the start of the gesture, so a long drag keeps stepping
   * instead of jumping to an end and stopping.
   */
  const anchor = useRef<number | null>(null);

  const onTouchStart = (event: React.TouchEvent) => {
    anchor.current = event.touches[0]?.clientY ?? null;
  };

  const onTouchMove = (event: React.TouchEvent) => {
    const y = event.touches[0]?.clientY;
    if (y === undefined || anchor.current === null) return;
    const delta = anchor.current - y;
    if (Math.abs(delta) < DRAG_STEP_PX) return;
    // Up adds, matching the up-arrow beneath it.
    if (delta > 0) add();
    else remove();
    anchor.current = y;
  };

  const onTouchEnd = () => {
    anchor.current = null;
  };

  const rows = Array.from({ length: count }, (_, i) => i);

  /** One column of dotted rules. Two of these sit side by side. */
  const column = (side: string) => (
    <div key={side} className="flex min-h-0 flex-1 flex-col gap-1.5">
      {rows.map((i) => (
        <div
          key={i}
          // border-border/70 rather than border-border: at this many rows the
          // rules are most of what is on screen, and at the token's own
          // strength the screen read as empty from arm's length.
          className="min-h-0 flex-1 rounded-md border-2 border-dotted border-border/70 transition-all duration-200"
        />
      ))}
    </div>
  );

  return createPortal(
    /* Above the transport bar's z-[70]: this is a takeover, and a player edge
       glowing across the bottom of it would give away that there is an app
       underneath. */
    <div
      className="fixed inset-0 z-[100] flex w-full flex-col bg-background px-4 pb-3 pt-safe select-none"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* An exit at each end, with the title centred between them.
          One X in a corner is the layout of a dialog you want dismissed; two
          means whichever hand is holding the phone has one under its thumb,
          which is the only ergonomic question a full-screen toy has. They also
          balance the row, so the title is centred by the layout rather than by
          arithmetic. */}
      <div className="flex shrink-0 items-center justify-between gap-3 pt-4">
        <button
          onClick={onExit}
          aria-label="Close"
          className="-ml-1 rounded-full p-1 text-muted-foreground transition-smooth active:scale-90 active:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X size={18} strokeWidth={2.5} />
        </button>

        {/* 12px: one more than the 11px the label used to be. Bold and centred
            rather than tracked-out small caps, because it is a name now and not
            a field label. */}
        <span className="text-[12px] font-bold tracking-[0.2em] text-primary">
          wO0tz!
        </span>

        <button
          onClick={onExit}
          aria-label="Close"
          className="-mr-1 rounded-full p-1 text-muted-foreground transition-smooth active:scale-90 active:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X size={18} strokeWidth={2.5} />
        </button>
      </div>

      {/* Air under the title, so the rules start as their own thing rather than
          as the next line of the header. */}
      <div className="min-h-0 flex-1 pt-5">
        {/* Two columns, which doubles the rules on screen for the same number
            of divisions — the grid reads as a texture at this density, and one
            column of it read as a list of empty boxes. */}
        <div className="flex h-full min-h-0 gap-1.5">
          {[column("left"), column("right")]}
        </div>
      </div>

      {/* The stepper, along the bottom and full width.
          It was a small pill floating at the right, which is where a secondary
          control goes — and this is the only control on the screen. Wide, tall
          and centred, it is reachable with either thumb without looking. */}
      <div className="flex shrink-0 gap-2 pb-safe pt-4">
        <button
          onClick={remove}
          disabled={count === MIN}
          aria-label="Fewer divisions"
          className="flex flex-1 items-center justify-center rounded-xl border border-border bg-card py-4 text-foreground transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-primary active:scale-95 active:bg-accent disabled:text-muted-foreground/30 disabled:active:scale-100 disabled:active:bg-card"
        >
          <ChevronDown size={26} strokeWidth={2.5} />
        </button>
        <button
          onClick={add}
          disabled={count === MAX}
          aria-label="More divisions"
          className="flex flex-1 items-center justify-center rounded-xl border border-border bg-card py-4 text-foreground transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-primary active:scale-95 active:bg-accent disabled:text-muted-foreground/30 disabled:active:scale-100 disabled:active:bg-card"
        >
          <ChevronUp size={26} strokeWidth={2.5} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
