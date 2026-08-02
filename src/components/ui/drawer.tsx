import { Drawer as DrawerPrimitive } from "vaul";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Thin wrapper over vaul.
 *
 * vaul is here rather than a hand-rolled sheet because drag-to-dismiss with
 * velocity is most of what makes a bottom sheet feel native, and that is not
 * worth reimplementing. This is the only headless-UI dependency in the project;
 * the rest of the original's shadcn tree was left behind.
 *
 * `layer` exists so sheets can stack: the artist sheet opens *over* an already
 * open event sheet, and both a portal's overlay and its content need to sit
 * above the one beneath.
 */
export const Drawer = DrawerPrimitive.Root;
export const DrawerTrigger = DrawerPrimitive.Trigger;
export const DrawerClose = DrawerPrimitive.Close;
export const DrawerTitle = DrawerPrimitive.Title;

const LAYERS = {
  base: { overlay: "z-50", content: "z-50" },
  over: { overlay: "z-[60]", content: "z-[60]" },
} as const;

export function DrawerContent({
  className,
  children,
  direction = "bottom",
  layer = "base",
  ...props
}: ComponentProps<typeof DrawerPrimitive.Content> & {
  direction?: "bottom" | "right";
  layer?: keyof typeof LAYERS;
}) {
  const z = LAYERS[layer];

  return (
    <DrawerPrimitive.Portal>
      <DrawerPrimitive.Overlay className={cn("fixed inset-0 bg-black/70", z.overlay)} />
      <DrawerPrimitive.Content
        className={cn(
          "fixed flex flex-col bg-background border-border",
          z.content,
          // Promote to its own layer so dragging composites instead of
          // repainting, and never animate width/height during a drag.
          "will-change-transform",
          direction === "bottom"
            ? "inset-x-0 bottom-[var(--player-h)] mx-auto max-h-[calc(90vh_-_var(--player-h))] max-w-md rounded-t-2xl border-t"
            : "inset-y-0 bottom-[var(--player-h)] right-0 w-[320px] max-w-[85vw] border-l",
          className,
        )}
        {...props}
      >
        {direction === "bottom" && (
          // Grab handle. Without it the sheet reads as a stuck panel rather
          // than something you can flick away.
          <div className="mx-auto mt-2 mb-1 h-1 w-10 flex-shrink-0 rounded-full bg-muted-foreground/40" />
        )}
        {children}
      </DrawerPrimitive.Content>
    </DrawerPrimitive.Portal>
  );
}
