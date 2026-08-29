import { cn } from "@/lib/utils";
import { FILTER_LABELS, type FilterKey } from "@/lib/filters";

interface FilterChipsProps {
  active: readonly FilterKey[];
  counts: Record<FilterKey, number>;
  onToggle: (key: FilterKey) => void;
}

/**
 * The order the row is drawn in, which is no longer the order in `FILTER_KEYS`.
 *
 * RA Pick takes the left edge on its own and the two crowd-size filters take
 * the right. That split is the point: RA Pick is somebody else's opinion about
 * the night, while Low-key and Busy are two ends of one measurement, so the gap
 * between them says they are different kinds of question. Reading order puts
 * the editorial one first.
 *
 * `FILTER_KEYS` still owns which filters exist and how they are counted; this
 * only owns where they sit.
 */
const LAYOUT: readonly FilterKey[] = ["pick", "lowkey", "busy"];

/** The first chip of the right-hand group — the one that pushes off the left. */
const FIRST_RIGHT: FilterKey = "lowkey";

/**
 * Three toggles under the date rail: one at each end of the row.
 *
 * Small on purpose — they occupy space that was already empty, and they should
 * read as an aside to the listings rather than as a control panel above them.
 *
 * A chip that would leave nothing is dimmed and inert rather than hidden:
 * chips appearing and disappearing as you tap makes the row jump under your
 * thumb, and "no RA picks tonight" is itself an answer.
 *
 * The night's event count used to live in this row. It is in the header now,
 * alternating with the date — it was the only thing here that was not a
 * control, and a bare number beside three chips reads like a fourth one.
 */
export function FilterChips({ active, counts, onToggle }: FilterChipsProps) {
  return (
    // `flex-1` so the row owns the width and `ml-auto` has something to push
    // against — without it all three chips huddle at the left.
    <div className="flex flex-1 flex-wrap items-center gap-1.5">
      {LAYOUT.map((key) => {
        const on = active.includes(key);
        const count = counts[key];
        const empty = count === 0 && !on;

        return (
          <button
            key={key}
            type="button"
            onClick={() => onToggle(key)}
            disabled={empty}
            aria-pressed={on}
            className={cn(
              "flex-shrink-0 rounded-full border px-2 py-0.5 text-[0.6875rem] leading-tight",
              key === FIRST_RIGHT && "ml-auto",
              "transition-colors duration-150",
              on
                ? "border-primary bg-primary/15 text-primary"
                : "border-border/70 text-muted-foreground",
              empty && "opacity-35",
              !on && !empty && "hover:text-foreground hover:border-border",
            )}
          >
            {FILTER_LABELS[key]}
            <span className="ml-1 opacity-60 tabular-nums">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
