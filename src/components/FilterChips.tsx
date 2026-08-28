import { Fragment } from "react";
import { cn } from "@/lib/utils";
import { FILTER_KEYS, FILTER_LABELS, type FilterKey } from "@/lib/filters";

interface FilterChipsProps {
  active: readonly FilterKey[];
  counts: Record<FilterKey, number>;
  onToggle: (key: FilterKey) => void;
  /** How many events the current filters leave — shown between the chips. */
  total: number;
}

/**
 * Three toggles under the date rail, with the night's total sitting in the gap
 * between the second and the third. Small on purpose — they occupy space that
 * was already empty, and they should read as an aside to the listings rather
 * than as a control panel above them.
 *
 * A chip that would leave nothing is dimmed and inert rather than hidden:
 * chips appearing and disappearing as you tap makes the row jump under your
 * thumb, and "no RA picks tonight" is itself an answer.
 */
export function FilterChips({ active, counts, onToggle, total }: FilterChipsProps) {
  return (
    // `flex-1` so the row owns the width and the `ml-auto`s have something to
    // push against — without it the chips huddle at the left and RA Pick sits
    // beside Busy rather than opposite it.
    <div className="flex flex-1 flex-wrap items-center gap-1.5">
      {FILTER_KEYS.map((key, i) => {
        const on = active.includes(key);
        const count = counts[key];
        const empty = count === 0 && !on;
        const last = i === FILTER_KEYS.length - 1;

        return (
          <Fragment key={key}>
            {/* The night's total, in the gap the row already had.
                It used to be a caption on its own line above the rail, which
                spent a whole row of the screen on two words.

                Rendered before the last chip, and both it and that chip carry
                `ml-auto`: two auto margins split the free space between them
                evenly, which parks the count in the middle of the run rather
                than shunting it against Busy or against RA Pick.

                A count, not a control — so no border, no chip, and not bold.
                The accent colour is what makes it findable; weight on top of
                colour would make it compete with the chips it sits between. */}
            {last && (
              <span className="ml-auto flex-shrink-0 text-[0.6875rem] font-normal leading-tight text-primary">
                {total} event{total !== 1 ? "s" : ""}
              </span>
            )}

            <button
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
          </Fragment>
        );
      })}
    </div>
  );
}
