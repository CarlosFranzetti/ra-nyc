import { Calendar } from "lucide-react";

interface EmptyStateProps {
  date: string;
}

export function EmptyState({ date }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <Calendar className="w-8 h-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold text-foreground">No events found</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-xs">
        There are no events listed for this date. Try checking another day.
      </p>
    </div>
  );
}
