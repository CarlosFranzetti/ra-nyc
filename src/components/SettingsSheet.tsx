import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useTheme, ColorTheme, LayoutDensity, Typography, NavStyle } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";

interface OptionButtonProps {
  active: boolean;
  onClick: () => void;
  label: string;
  description?: string;
}

function OptionButton({ active, onClick, label, description }: OptionButtonProps) {
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
      <span className="text-sm font-medium">{label}</span>
      {description && (
        <span className="text-xs opacity-70 mt-0.5">{description}</span>
      )}
    </button>
  );
}

interface OptionGroupProps {
  title: string;
  children: React.ReactNode;
}

function OptionGroup({ title, children }: OptionGroupProps) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
        {title}
      </h3>
      <div className="grid grid-cols-2 gap-2">{children}</div>
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
    navStyle,
    setNavStyle,
  } = useTheme();

  const colorOptions: { value: ColorTheme; label: string; desc: string }[] = [
    { value: "monochrome", label: "Monochrome", desc: "Pure black & white" },
    { value: "neon", label: "Neon", desc: "Cyan accent" },
    { value: "warm", label: "Warm", desc: "Amber tones" },
    { value: "light", label: "Light", desc: "Light mode" },
  ];

  const densityOptions: { value: LayoutDensity; label: string; desc: string }[] = [
    { value: "compact", label: "Compact", desc: "Default spacing" },
    { value: "ultra-compact", label: "Ultra", desc: "Maximum density" },
    { value: "relaxed", label: "Relaxed", desc: "More breathing room" },
  ];

  const fontOptions: { value: Typography; label: string; desc: string }[] = [
    { value: "default", label: "Default", desc: "System fonts" },
    { value: "techno", label: "Techno", desc: "Space Grotesk" },
    { value: "editorial", label: "Editorial", desc: "Playfair + Inter" },
  ];

  const navOptions: { value: NavStyle; label: string; desc: string }[] = [
    { value: "default", label: "Header", desc: "Calendar in header" },
    { value: "bottom-nav", label: "Bottom Nav", desc: "Tab bar" },
    { value: "fab", label: "FAB", desc: "Floating button" },
    { value: "swipe", label: "Swipe", desc: "Gesture nav" },
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
          <OptionGroup title="Color Theme">
            {colorOptions.map((opt) => (
              <OptionButton
                key={opt.value}
                active={colorTheme === opt.value}
                onClick={() => setColorTheme(opt.value)}
                label={opt.label}
                description={opt.desc}
              />
            ))}
          </OptionGroup>

          <OptionGroup title="Layout Density">
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

          <OptionGroup title="Typography">
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

          <OptionGroup title="Navigation">
            {navOptions.map((opt) => (
              <OptionButton
                key={opt.value}
                active={navStyle === opt.value}
                onClick={() => setNavStyle(opt.value)}
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
