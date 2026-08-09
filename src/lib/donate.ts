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
export interface DonateTarget {
  label: string;
  url: string;
  /**
   * A pre-rendered QR of `url`, served from `public/`.
   *
   * Generated once and committed rather than encoded in the browser: the URL
   * never changes, so a QR library in the bundle would be ~15 KB spent
   * recomputing a constant on every visit. Each file is about 1.5 KB of paths.
   *
   * It has to stay in step with `url` by hand — regenerate with
   * `npx qrcode -t svg -o public/donate-<name>.svg "<url>"` if a handle
   * changes, or the code will point at the previous wallet.
   */
  qr: string;
}

export const DONATE: readonly DonateTarget[] = [
  {
    label: "Cash App",
    url: "https://cash.app/$hypedrum",
    qr: "/donate-cashapp.svg",
  },
  {
    label: "PayPal",
    url: "https://paypal.me/losfiesta",
    qr: "/donate-paypal.svg",
  },
].filter((target) => target.url !== "");
