/**
 * Wordmarks for the two ride apps.
 *
 * Drawn as text in an SVG rather than shipped as the companies' logo files, and
 * that is a licensing decision as much as a weight one. Uber's and Lyft's marks
 * are trademarks with brand guidelines attached; reproducing the actual
 * artwork inside a third-party app is the thing those guidelines exist to
 * govern. A plain wordmark set in the interface's own font makes no claim to be
 * their logo — it names the destination the way the "Open in Maps" button names
 * Maps.
 *
 * They inherit `currentColor` for the same reason everything else here does:
 * the button is themed, and a fixed brand colour would be the one element on
 * screen that ignores the theme. It would also be the more legally interesting
 * choice, since brand colour plus brand name is most of what a logo is.
 *
 * Sized in em so they scale with the label beside them rather than needing a
 * second set of numbers per density.
 */

interface MarkProps {
  className?: string;
}

/**
 * `textLength` with `lengthAdjust="spacingAndGlyphs"` pins the drawn width
 * regardless of which typeface the preference is on — without it the two marks
 * would be different widths in Condensed and the button row would go ragged.
 */
export function UberMark({ className }: MarkProps) {
  return (
    <svg
      viewBox="0 0 44 16"
      role="img"
      aria-label="Uber"
      className={className}
      fill="currentColor"
    >
      <text
        x="0"
        y="12.5"
        textLength="44"
        lengthAdjust="spacingAndGlyphs"
        fontSize="14"
        fontWeight="700"
        letterSpacing="-0.5"
        fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
      >
        Uber
      </text>
    </svg>
  );
}

export function LyftMark({ className }: MarkProps) {
  return (
    <svg
      viewBox="0 0 44 16"
      role="img"
      aria-label="Lyft"
      className={className}
      fill="currentColor"
    >
      <text
        x="0"
        y="12.5"
        textLength="44"
        lengthAdjust="spacingAndGlyphs"
        fontSize="14"
        fontWeight="700"
        letterSpacing="-0.5"
        fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
      >
        Lyft
      </text>
    </svg>
  );
}
