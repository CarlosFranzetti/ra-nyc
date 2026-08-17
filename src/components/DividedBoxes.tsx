import { useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, X } from "lucide-react";

const MIN = 1;
const MAX = 20;

/**
 * The hidden screen.
 *
 * Reached by opening Customize, closing it, and tapping the logo twenty-six
 * times in a row. Undocumented on purpose — it is not in the settings, not in
 * the README, and nothing on screen hints at it.
 *
 * The only thing added to the original is a way out. Everything else is the
 * component as it was written, with one substitution: the hard-coded neutrals
 * and the amber accent are gone, and every colour now comes from the same
 * tokens the rest of the app uses. That is the whole reason it can live here —
 * a greyscale panel with an amber counter would look like a different app
 * pasted in, and this way it takes the theme you happen to be on. The dotted
 * borders and the proportions are untouched.
 *
 * Rendered through a portal into `document.body`, which is not optional:
 * `position: fixed` is contained by any ancestor with a `backdrop-filter`, and
 * the header this is triggered from has one. Rendered in place, a fixed
 * full-screen overlay would be trapped inside the header's own box.
 */
export function DividedBoxes({ onExit }: { onExit: () => void }) {
  const [count, setCount] = useState(7);

  const add = () => setCount((c) => Math.min(MAX, c + 1));
  const remove = () => setCount((c) => Math.max(MIN, c - 1));

  const boxes = Array.from({ length: count }, (_, i) => i);

  return createPortal(
    /* Above the transport bar's z-[70]: this is a takeover, and a player edge
       glowing across the bottom of it would give away that there is an app
       underneath. */
    <div className="fixed inset-0 z-[100] flex w-full flex-col bg-background px-4 pb-3 pt-safe select-none">
      {/* header */}
      <div className="flex shrink-0 items-baseline justify-between gap-3 pb-3 pt-4">
        <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Divisions
        </span>
        <div className="flex items-center gap-3">
          <span className="text-[11px] tabular-nums tracking-[0.2em] text-primary">
            {String(count).padStart(2, "0")}
          </span>
          {/* The addition. Deliberately quiet — the same muted grey as the
              word "Divisions" rather than anything that draws the eye, because
              a prominent exit is the one control this screen does not need
              anybody hunting for. */}
          <button
            onClick={onExit}
            aria-label="Close"
            className="-mr-1 rounded-full p-1 text-muted-foreground transition-smooth active:scale-90 active:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X size={18} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {/* equally divided dotted boxes */}
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {boxes.map((i) => (
          <div
            key={i}
            className="flex min-h-0 flex-1 items-center rounded-md border-2 border-dotted border-border px-3 transition-all duration-200"
          >
            <span className="text-[10px] tabular-nums tracking-widest text-muted-foreground">
              {String(i + 1).padStart(2, "0")}
            </span>
          </div>
        ))}
      </div>

      {/* stepper */}
      <div className="flex shrink-0 justify-end pb-safe pt-3">
        <div className="flex items-center overflow-hidden rounded-full border border-border bg-card">
          <button
            onClick={remove}
            disabled={count === MIN}
            aria-label="Remove a box"
            className="px-5 py-3 text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary active:bg-accent disabled:text-muted-foreground/40 disabled:active:bg-transparent"
          >
            <ChevronDown size={20} strokeWidth={2.5} />
          </button>
          <div className="w-px self-stretch bg-border" />
          <button
            onClick={add}
            disabled={count === MAX}
            aria-label="Add a box"
            className="px-5 py-3 text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary active:bg-accent disabled:text-muted-foreground/40 disabled:active:bg-transparent"
          >
            <ChevronUp size={20} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
