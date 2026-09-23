import type { Config } from "tailwindcss";

/**
 * Literal pixels, for the scales that describe *how big a thing is* rather than
 * how much air is around it.
 *
 * Tailwind ships one `spacing` scale and points `width`, `height`, `min-*` and
 * `max-*` at it alongside `padding`, `margin` and `gap`. That is fine in a
 * stock install, where the scale is a set of constants. It is not fine here:
 * this config rewrites `spacing` to multiply by `--space`, the Density
 * preference — so every `h-4 w-4` in the app was a *density-scaled icon*.
 *
 * The numbers on that: `h-4` is 16px at Airy (--space 1.02) and 7px at Tight
 * (0.45). A clock glyph next to a start time, a map pin, the chevron on a
 * disclosure, the `+` on a lineup chip — all of them silently shrank by more
 * than half when you asked for a denser list, because "denser list" and
 * "smaller icons" were the same variable. Thirty-eight glyphs were on this
 * scale. Nobody chose it; it is what `h-4` means by default.
 *
 * Splitting the two is the whole fix, and it is a config change rather than
 * thirty-eight edits: `p-4` still means "16px of air, scaled by Density",
 * `h-4` now means "16px, always". It is the same rule `.tap` already follows in
 * index.css for the same reason — how big a control is is not a matter of taste
 * about how roomy the layout should be.
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
    /**
     * Six rungs, and nothing between them.
     *
     * The app had eleven type sizes: five arbitrary rem values written inline
     * — 0.5, 0.5625, 0.625, 0.6875, 0.8125 — alongside six of Tailwind's own.
     * Sixty-eight usages spread over eleven sizes, several of them one pixel
     * apart, which is not a scale but a list of decisions each made locally
     * and none made twice the same way. Two subtitles a pixel different from
     * each other is not a design; it is a diff nobody noticed.
     *
     * They collapse cleanly, because the eleven were already clustered: 10px
     * and 12px and 14px did most of the work. Sixty of the sixty-eight land
     * on their existing size; the rest move by a pixel or two. What changes
     * is that there is now somewhere for the next one to go.
     *
     * Named for the job rather than the size, so a component asks for "the
     * secondary line" and gets whatever that is, instead of asking for
     * eleven-sixteenths of a rem and getting whatever it typed.
     *
     * rem, not px, deliberately: this is the ladder the Text size preference
     * and the typography rungs multiply. Spacing is px for the mirror-image
     * reason — see the note on `spacing`. Type scales; air scales at 60%;
     * controls and glyphs do not scale at all. Three rules, and every size in
     * the app is one of them.
     *
     * The line-height is part of the rung, not a separate decision at each
     * call site. That is where `leading-tight` sprinkled through the markup
     * came from, and it meant the same size read at two different densities
     * depending on which file it was in.
     */
    fontSize: {
      // Counters and badges. Rides inside a control, never alone.
      micro: ["0.625rem", { lineHeight: "1.2" }],
      // The second line: venue, provider, "3 of 9", timestamps.
      meta: ["0.75rem", { lineHeight: "1.25" }],
      // The first line of a row, and the app's default reading size.
      body: ["0.875rem", { lineHeight: "1.3" }],
      // Body copy with room around it — a sheet's paragraph, a setting.
      lead: ["1rem", { lineHeight: "1.4" }],
      // A sheet's heading.
      title: ["1.25rem", { lineHeight: "1.25" }],
      // The one big thing on a screen.
      display: ["1.625rem", { lineHeight: "1.1" }],
    },

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
      // See FIXED above. These four are the scales that say how big something
      // *is*; only padding, margin and gap answer to Density now.
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
