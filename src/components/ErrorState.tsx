import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  onRetry: () => void;
}

export function ErrorState({ onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
        <AlertCircle className="w-8 h-8 text-destructive" />
      </div>
      <h3 className="text-lg font-semibold text-foreground">Failed to load events</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-xs mb-4">
        We couldn't fetch events right now. Please try again.
      </p>
      <Button onClick={onRetry} variant="outline" size="sm">
        <RefreshCw className="w-4 h-4 mr-2" />
        Retry
      </Button>
    </div>
  );
}
