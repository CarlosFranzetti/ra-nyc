/**
 * Where to send a tip, if anyone wants to.
 *
 * Here rather than inline in the settings sheet for one reason: these are the
 * author's own handles, and a URL that goes to a stranger's wallet is the kind
 * of thing that should be changed in a file called `donate.ts` rather than
 * found by grepping a component tree.
 *
 * Removing an entry hides that link; an empty array hides the row entirely, so
 * a fork of this app shows nothing rather than quietly collecting for someone
 * else.
 */
export interface DonateTarget {
  label: string;
  url: string;
}

export const DONATE: readonly DonateTarget[] = [
  { label: "Cash App", url: "https://cash.app/$hypedrum" },
  { label: "PayPal", url: "https://paypal.me/losfiesta" },
].filter((target) => target.url !== "");
