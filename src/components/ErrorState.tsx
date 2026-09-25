import { AlertCircle, RefreshCw } from "lucide-react";

interface ErrorStateProps {
  onRetry: () => void;
  /** The API's own message, e.g. "Resident Advisor responded with 403". */
  detail?: string;
  retrying?: boolean;
}

export function ErrorState({ onRetry, detail, retrying }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
        <AlertCircle className="w-8 h-8 text-destructive" />
      </div>
      <h3 className="text-lg font-semibold text-foreground">Failed to load events</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-xs mb-1">
        We couldn&apos;t fetch events right now.
      </p>
      {/* Show the real reason — hiding it makes production failures
          undiagnosable from the UI. */}
      {detail && (
        <p className="text-xs text-muted-foreground/70 mb-4 max-w-xs">{detail}</p>
      )}
      <button
        onClick={onRetry}
        disabled={retrying}
        className="inline-flex items-center gap-2 text-sm border border-border rounded-md px-3 py-1.5 bg-card hover:bg-accent active:bg-accent disabled:opacity-50 transition-smooth"
      >
        <RefreshCw className={retrying ? "w-4 h-4 animate-spin" : "w-4 h-4"} />
        {retrying ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}
