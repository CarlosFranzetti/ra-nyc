import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

/**
 * Minimal bottom sheet.
 *
 * Hand-rolled rather than pulling in Radix: the app needs one dialog pattern,
 * and a dependency that ships its own focus manager and portal is a lot of
 * bundle for a single sheet on a phone-sized page.
 */
export default function Sheet({ open, onClose, title, children }: SheetProps) {
  // Escape to dismiss, and lock body scroll so the page behind doesn't move
  // under the sheet on iOS.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 animate-in fade-in"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative w-full max-w-md max-h-[85vh] overflow-y-auto",
          "bg-card border-t border-border rounded-t-2xl",
          "animate-in slide-in-from-bottom duration-200",
        )}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* Drag affordance — purely visual, but without it the sheet reads as
            a stuck panel rather than something dismissible. */}
        <div className="sticky top-0 bg-card z-10 pt-2 pb-3 px-[var(--card-pad)] border-b border-border">
          <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-muted-foreground/40" />
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-muted-foreground hover:text-foreground active:text-foreground px-2 py-1 -mr-2"
            >
              Done
            </button>
          </div>
        </div>

        <div className="p-[var(--card-pad)]">{children}</div>
      </div>
    </div>
  );
}
