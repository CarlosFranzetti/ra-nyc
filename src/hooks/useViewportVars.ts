import { useEffect } from "react";

/**
 * Publishes the *visual* viewport to CSS, as `--vvh` and `--kb`.
 *
 * ## Why this is needed at all
 *
 * A phone has two viewports and they disagree the moment the keyboard opens.
 * The **layout** viewport does not change — it is what `position: fixed`,
 * `100vh` and even `100dvh` are measured against. The **visual** viewport is
 * what you can actually see, and on iOS the keyboard covers the bottom of the
 * layout viewport without shrinking it.
 *
 * So a sheet pinned with `bottom: 0` and sized in `dvh` is, with the keyboard
 * up, a sheet whose lower half is behind the keyboard. That is exactly what
 * happened to search: tapping the field raised the keyboard over the sheet the
 * field lived in.
 *
 * `dvh` does not rescue this, despite the name. "Dynamic" there means the
 * browser's own collapsing toolbars, not the software keyboard — a distinction
 * that costs a round to learn because the two look identical from the outside.
 *
 * ## What it publishes
 *
 * - `--vvh` — the visible height. What a full-screen sheet should actually be.
 * - `--kb` — how much of the layout viewport's *bottom* is covered right now.
 *   Zero with no keyboard, so every rule that uses it is inert until it matters.
 *
 * `--kb` subtracts `offsetTop` as well as the height, because iOS also scrolls
 * the visual viewport within the layout viewport when the keyboard opens.
 * Without that term, a scrolled viewport reports a keyboard taller than it is
 * and the sheet floats above it with a band of page showing underneath.
 *
 * Mounted once at the app root rather than per sheet: it is a fact about the
 * window, several things want it, and two subscribers writing the same two
 * custom properties would be one subscriber too many.
 */
export function useViewportVars(): void {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;

    const apply = () => {
      // No visualViewport (older desktop browsers) means no software keyboard
      // to worry about, so the layout viewport is the honest answer.
      const height = viewport?.height ?? window.innerHeight;
      const covered = viewport
        ? window.innerHeight - viewport.height - viewport.offsetTop
        : 0;

      // Rounded: sub-pixel values here would rewrite both properties on every
      // frame of a momentum scroll, and nothing downstream can use the decimal.
      root.style.setProperty("--vvh", `${Math.round(height)}px`);
      root.style.setProperty("--kb", `${Math.max(0, Math.round(covered))}px`);
    };

    apply();

    // `scroll` as well as `resize`: the keyboard opening fires resize, but iOS
    // then scrolls the visual viewport to reveal the focused field, and that
    // second move only reports as a scroll.
    viewport?.addEventListener("resize", apply);
    viewport?.addEventListener("scroll", apply);
    window.addEventListener("orientationchange", apply);

    return () => {
      viewport?.removeEventListener("resize", apply);
      viewport?.removeEventListener("scroll", apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, []);
}
