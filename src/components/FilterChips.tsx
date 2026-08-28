import { cn } from "@/lib/utils";
import { FILTER_KEYS, FILTER_LABELS, type FilterKey } from "@/lib/filters";

interface FilterChipsProps {
  active: readonly FilterKey[];
  counts: Record<FilterKey, number>;
  onToggle: (key: FilterKey) => void;
  /** How many events the current filters leave — held against the right edge. */
  total: number;
}

/**
 * Three toggles under the date rail, grouped together on the left, with the
 * night's total held against the right edge. Small on purpose — they occupy
 * space that was already empty, and they should read as an aside to the
 * listings rather than as a control panel above them.
 *
 * A chip that would leave nothing is dimmed and inert rather than hidden:
 * chips appearing and disappearing as you tap makes the row jump under your
 * thumb, and "no RA picks tonight" is itself an answer.
 */
export function FilterChips({ active, counts, onToggle, total }: FilterChipsProps) {
  return (
    // `flex-1` so the row owns the width and the count's `ml-auto` has
    // something to push against — without it the whole row huddles at the left
    // and the count sits against RA Pick rather than at the right edge.
    <div className="flex flex-1 flex-wrap items-center gap-1.5">
      {FILTER_KEYS.map((key) => {
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

      {/* The night's total, hard right.
          All three chips are controls and belong together on the left — RA
          Pick used to be pushed to the far side, which read as though it were
          a different kind of thing. It is not; it is the third filter.

          `ml-auto` on this instead, so the one element that is *not* a control
          is the one holding the right edge. No border, no chip, and not bold:
          the accent colour is what makes it findable, and weight on top of
          colour would put it in competition with the chips beside it. */}
      <span className="ml-auto flex-shrink-0 text-[0.6875rem] font-normal leading-tight text-primary">
        {total} event{total !== 1 ? "s" : ""}
      </span>
    </div>
  );
}
