/**
 * Where to send a tip, if anyone wants to.
 *
 * Here rather than inline in the settings sheet for one reason: these are the
 * author's own handles, and a URL that goes to a stranger's wallet is the kind
 * of thing that should be changed in a file called `donate.ts` rather than
 * found by grepping a component tree.
 *
 * Empty strings hide the link entirely, so a fork of this app shows nothing
 * rather than quietly collecting for someone else.
 */
export const DONATE = {
  /**
   * Deliberately blank until the real handles are filled in — see readthis.md.
   * A guessed payment URL is worse than no link at all: it either 404s or, far
   * worse, sends money to whoever happens to own that tag.
   *
   * e.g. "https://cash.app/$yourtag"
   */
  cashApp: "",
  /** e.g. "https://paypal.me/yourname" */
  payPal: "",
} as const;
