import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useTheme, ColorTheme, LayoutDensity, Typography } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";

interface OptionButtonProps {
  active: boolean;
  onClick: () => void;
  label: string;
  description?: string;
  color?: string;
}

function OptionButton({ active, onClick, label, description, color }: OptionButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-start p-3 rounded-lg border transition-all duration-150 text-left",
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border/50 bg-card hover:bg-accent text-muted-foreground hover:text-foreground"
      )}
    >
      <div className="flex items-center gap-2">
        {color && (
          <div 
            className="w-3 h-3 rounded-full" 
            style={{ background: color }}
          />
        )}
        <span className="text-sm font-medium">{label}</span>
      </div>
      {description && (
        <span className="text-xs opacity-60 mt-0.5">{description}</span>
      )}
    </button>
  );
}

interface OptionGroupProps {
  title: string;
  children: React.ReactNode;
  columns?: 2 | 3 | 4;
}

function OptionGroup({ title, children, columns = 2 }: OptionGroupProps) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
        {title}
      </h3>
      <div className={cn(
        "grid gap-2",
        columns === 2 && "grid-cols-2",
        columns === 3 && "grid-cols-3",
        columns === 4 && "grid-cols-4"
      )}>
        {children}
      </div>
    </div>
  );
}

export function SettingsSheet() {
  const {
    colorTheme,
    setColorTheme,
    layoutDensity,
    setLayoutDensity,
    typography,
    setTypography,
  } = useTheme();

  const colorOptions: { value: ColorTheme; label: string; color: string }[] = [
    { value: "neon", label: "Neon", color: "hsl(185 100% 50%)" },
    { value: "vapor", label: "Vapor", color: "hsl(320 100% 60%)" },
    { value: "matrix", label: "Matrix", color: "hsl(120 100% 45%)" },
    { value: "sunset", label: "Sunset", color: "hsl(25 100% 55%)" },
  ];

  const densityOptions: { value: LayoutDensity; label: string; desc: string }[] = [
    { value: "tight", label: "Tight", desc: "Dense layout" },
    { value: "default", label: "Default", desc: "Balanced" },
    { value: "airy", label: "Airy", desc: "Spacious" },
  ];

  const fontOptions: { value: Typography; label: string; desc: string }[] = [
    { value: "system", label: "System", desc: "Clean & native" },
    { value: "mono", label: "Mono", desc: "JetBrains Mono" },
    { value: "display", label: "Display", desc: "Bold headlines" },
  ];


  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground"
        >
          <Settings className="w-5 h-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[300px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Customize</SheetTitle>
        </SheetHeader>
        
        <div className="mt-6 space-y-6">
          <OptionGroup title="Theme" columns={4}>
            {colorOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setColorTheme(opt.value)}
                className={cn(
                  "flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-all",
                  colorTheme === opt.value
                    ? "border-primary bg-primary/10"
                    : "border-border/50 bg-card hover:bg-accent"
                )}
              >
                <div 
                  className={cn(
                    "w-6 h-6 rounded-full",
                    colorTheme === opt.value && "ring-2 ring-offset-2 ring-offset-background ring-primary"
                  )}
                  style={{ background: opt.color }}
                />
                <span className="text-[10px] font-medium">{opt.label}</span>
              </button>
            ))}
          </OptionGroup>

          <OptionGroup title="Density" columns={3}>
            {densityOptions.map((opt) => (
              <OptionButton
                key={opt.value}
                active={layoutDensity === opt.value}
                onClick={() => setLayoutDensity(opt.value)}
                label={opt.label}
                description={opt.desc}
              />
            ))}
          </OptionGroup>

          <OptionGroup title="Typography" columns={3}>
            {fontOptions.map((opt) => (
              <OptionButton
                key={opt.value}
                active={typography === opt.value}
                onClick={() => setTypography(opt.value)}
                label={opt.label}
                description={opt.desc}
              />
            ))}
          </OptionGroup>

        </div>
      </SheetContent>
    </Sheet>
  );
}
