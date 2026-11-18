import { addDays, format, isSameDay } from "date-fns";
import { Calendar } from "lucide-react";

interface EmptyStateProps {
  /** The day with nothing on it, so it is never offered back as a way out. */
  selectedDate?: Date;
  /** The app's "tonight" (before 3:30am that is still yesterday). */
  tonight?: Date;
  /** Present: the state offers up to three other nights to try. */
  onPick?: (date: Date) => void;
}

/** Tonight, then the next Friday and Saturday after it, minus the day being viewed. */
function waysOut(tonight: Date, selected: Date): Date[] {
  const next = (dow: number) => {
    const delta = (dow - tonight.getDay() + 7) % 7;
    return addDays(tonight, delta === 0 ? 7 : delta);
  };
  return [tonight, next(5), next(6)].filter((d) => !isSameDay(d, selected));
}

export function EmptyState({ selectedDate, tonight, onPick }: EmptyStateProps = {}) {
  const choices = onPick && tonight && selectedDate ? waysOut(tonight, selectedDate) : [];
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <Calendar className="w-8 h-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold text-foreground">No events found</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-xs">
        There are no events listed for this date. Try checking another day.
      </p>
      {choices.length > 0 && (
        <div data-empty-ways className="mt-5 flex flex-wrap justify-center gap-2">
          {choices.map((date) => (
            <button
              key={date.toISOString()}
              type="button"
              onClick={() => onPick?.(date)}
              className="tap-row min-w-[44px] justify-center rounded-lg border border-primary/50 bg-primary/10 px-4 text-[0.8125rem] font-medium text-primary glow-primary-sm transition-all active:scale-95"
            >
              {isSameDay(date, tonight!) ? "Tonight" : format(date, "EEE d")}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
