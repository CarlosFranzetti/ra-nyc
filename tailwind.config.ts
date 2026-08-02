import type { Config } from "tailwindcss";

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
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
} satisfies Config;
