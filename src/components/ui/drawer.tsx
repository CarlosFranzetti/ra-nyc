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
 */
export const Drawer = DrawerPrimitive.Root;
export const DrawerTrigger = DrawerPrimitive.Trigger;
export const DrawerClose = DrawerPrimitive.Close;
export const DrawerTitle = DrawerPrimitive.Title;

export function DrawerContent({
  className,
  children,
  direction = "bottom",
  ...props
}: ComponentProps<typeof DrawerPrimitive.Content> & {
  direction?: "bottom" | "right";
}) {
  return (
    <DrawerPrimitive.Portal>
      <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70" />
      <DrawerPrimitive.Content
        className={cn(
          "fixed z-50 flex flex-col bg-background border-border",
          direction === "bottom"
            ? "inset-x-0 bottom-0 mx-auto max-h-[90vh] max-w-md rounded-t-2xl border-t"
            : "inset-y-0 right-0 w-[320px] max-w-[85vw] border-l",
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
