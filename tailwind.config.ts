import type { Config } from "tailwindcss";

/**
 * Literal pixels, for the scales that say how big a thing *is* rather than how
 * much air is around it.
 *
 * Tailwind ships one `spacing` scale and points `width`, `height` and `min-*`
 * at it alongside `padding`, `margin` and `gap`. That is fine in a stock
 * install, where the scale is a set of constants. It is not fine here, because
 * this config rewrites `spacing` to multiply by `--space`, the Density
 * preference — so `h-4 w-4`, the most ordinary way there is to size an icon,
 * meant **16px at Airy and 7px at Tight**.
 *
 * Thirty-eight glyphs were on that scale: the clock before a start time, the
 * pin before a venue, the headphone above a lineup, the `+` on every chip. Ask
 * for a denser list and they shrank by more than half, because "denser list"
 * and "smaller icons" were the same variable.
 *
 * This is the one piece of the reverted sizing release that comes back, and it
 * comes back because it is a *sizing fault* rather than a matter of taste: a
 * glyph drawn at 45% of its intended size next to type that has not moved is
 * wrong at any density. The type ladder from that release — the part that
 * changed how the app felt — stays reverted.
 *
 * It is also the same rule `.tap` already follows in index.css, and the same
 * rule the flyer and the header follow, each of which had to be rescued from
 * this scale by hand in an earlier round. Fixing it at the config is what stops
 * the next component acquiring it again by typing the obvious thing.
 */
const FIXED = {
  "0": "0px",
  px: "1px",
  "0.5": "2px",
  "1": "4px",
  "1.5": "6px",
  "2": "8px",
  "2.5": "10px",
  "3": "12px",
  "3.5": "14px",
  "4": "16px",
  "5": "20px",
  "6": "24px",
  "7": "28px",
  "8": "32px",
  "9": "36px",
  "10": "40px",
  "11": "44px",
  "12": "48px",
  "14": "56px",
  "16": "64px",
  "20": "80px",
  "24": "96px",
  "28": "112px",
  "32": "128px",
  "36": "144px",
  "40": "160px",
  "44": "176px",
  "48": "192px",
  "52": "208px",
  "56": "224px",
  "60": "240px",
  "64": "256px",
  "72": "288px",
  "80": "320px",
  "96": "384px",
};

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        // Venue names get their own hue per theme, off the primary, so they read
        // as a distinct kind of information rather than another accent.
        venue: "hsl(var(--venue))",
        // One green across every theme — see the note by --play in index.css.
        play: "hsl(var(--play))",
      },
      // Spacing is driven by --space (set by the density preference) and
      // expressed in px rather than rem *on purpose*: the text-size preference
      // scales the root font size, and if spacing were rem it would scale with
      // it — so picking "Large" text would also blow the layout apart. Keeping
      // the two in different units is what makes them independent controls.
      spacing: {
        "0.5": "calc(2px * var(--space, 1))",
        "1": "calc(4px * var(--space, 1))",
        "1.5": "calc(6px * var(--space, 1))",
        "2": "calc(8px * var(--space, 1))",
        "2.5": "calc(10px * var(--space, 1))",
        "3": "calc(12px * var(--space, 1))",
        "3.5": "calc(14px * var(--space, 1))",
        "4": "calc(16px * var(--space, 1))",
        "5": "calc(20px * var(--space, 1))",
        "6": "calc(24px * var(--space, 1))",
        "7": "calc(28px * var(--space, 1))",
        "8": "calc(32px * var(--space, 1))",
        "9": "calc(36px * var(--space, 1))",
        "10": "calc(40px * var(--space, 1))",
        "11": "calc(44px * var(--space, 1))",
        "12": "calc(48px * var(--space, 1))",
        "14": "calc(56px * var(--space, 1))",
        "16": "calc(64px * var(--space, 1))",
        "20": "calc(80px * var(--space, 1))",
        "24": "calc(96px * var(--space, 1))",
        "28": "calc(112px * var(--space, 1))",
        "32": "calc(128px * var(--space, 1))",
        "36": "calc(144px * var(--space, 1))",
        "40": "calc(160px * var(--space, 1))",
        "44": "calc(176px * var(--space, 1))",
        "48": "calc(192px * var(--space, 1))",
        "52": "calc(208px * var(--space, 1))",
        "56": "calc(224px * var(--space, 1))",
        "60": "calc(240px * var(--space, 1))",
        "64": "calc(256px * var(--space, 1))",
        "72": "calc(288px * var(--space, 1))",
        "80": "calc(320px * var(--space, 1))",
        "96": "calc(384px * var(--space, 1))",
      },
      // See FIXED above: these say how big a thing is, so only padding, margin
      // and gap answer to Density.
      width: FIXED,
      height: FIXED,
      minWidth: FIXED,
      minHeight: FIXED,

      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
} satisfies Config;
