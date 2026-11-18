import { Calendar } from "lucide-react";

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <Calendar className="w-8 h-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold text-foreground">No events found</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-xs">
        There are no events listed for this date. Try checking another day.
      </p>
      {/* Proposal: three ways out, instead of a dead end. Needs an onPick(date) prop. */}
      <div className="polish-only mt-5 gap-2">
        {["Tonight", "Fri 20", "Sat 21"].map((d) => (
          <button key={d} className="h-[44px] rounded-lg border border-primary/50 bg-primary/10 px-4 text-[0.8125rem] font-medium text-primary glow-primary-sm">
            {d}
          </button>
        ))}
      </div>
    </div>
  );
}
