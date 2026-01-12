import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";

interface FloatingActionButtonProps {
  onClick: () => void;
}

export function FloatingActionButton({ onClick }: FloatingActionButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full",
        "bg-primary text-primary-foreground shadow-lg",
        "flex items-center justify-center",
        "hover:scale-105 active:scale-95 transition-transform duration-150"
      )}
    >
      <CalendarDays className="w-6 h-6" />
    </button>
  );
}
