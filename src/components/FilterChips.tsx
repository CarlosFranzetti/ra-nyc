import { cn } from "@/lib/utils";
import { FILTER_KEYS, FILTER_LABELS, type FilterKey } from "@/lib/filters";

interface FilterChipsProps {
  active: readonly FilterKey[];
  counts: Record<FilterKey, number>;
  onToggle: (key: FilterKey) => void;
}

/**
 * Three toggles under the date line. Small on purpose — they sit in space that
 * was already empty, and they should read as an aside to the count rather than
 * as a control panel above the listings.
 *
 * A chip that would leave nothing is dimmed and inert rather than hidden:
 * chips appearing and disappearing as you tap makes the row jump under your
 * thumb, and "no free parties tonight" is itself an answer.
 */
export function FilterChips({ active, counts, onToggle }: FilterChipsProps) {
  return (
    // `flex-1` so the row owns the width and the `ml-auto` on the last chip has
    // something to push against — without it the chips huddle at the left and
    // RA Pick sits beside Busy rather than opposite it.
    <div className="flex flex-1 flex-wrap items-center gap-1.5">
      {FILTER_KEYS.map((key, i) => {
        const on = active.includes(key);
        const count = counts[key];
        const empty = count === 0 && !on;
        const last = i === FILTER_KEYS.length - 1;

        return (
          <button
            key={key}
            type="button"
            onClick={() => onToggle(key)}
            disabled={empty}
            aria-pressed={on}
            className={cn(
              "flex-shrink-0 rounded-full border px-2 py-0.5 text-[0.6875rem] leading-tight",
              last && "ml-auto",
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
