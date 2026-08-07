import { describe, expect, it } from "vitest";
import { shouldOfferTickets, TICKET_AFTER_SECONDS } from "../../src/lib/tickets.js";

const party = { label: "Mister Sunday", url: "https://ra.co/events/1" };

describe("shouldOfferTickets", () => {
  it("shows nothing to someone who has just arrived", () => {
    // The guarantee that matters: opening a party and hearing a few seconds
    // must never produce a promotion.
    expect(shouldOfferTickets(party, 0)).toBe(false);
    expect(shouldOfferTickets(party, 5)).toBe(false);
  });

  it("still shows nothing one second short", () => {
    expect(shouldOfferTickets(party, TICKET_AFTER_SECONDS - 1)).toBe(false);
  });

  it("offers tickets once someone has really listened", () => {
    expect(shouldOfferTickets(party, TICKET_AFTER_SECONDS)).toBe(true);
    expect(shouldOfferTickets(party, 600)).toBe(true);
  });

  it("never offers tickets for an artist's own catalogue", () => {
    // Tapping a DJ is not attending a party, and there is nothing to buy.
    expect(shouldOfferTickets(null, 10_000)).toBe(false);
  });

  it("asks for a full minute, not a token pause", () => {
    // Guards the intent rather than the number: if someone lowers this to a
    // few seconds the link becomes an advert, and that should be a visible
    // decision rather than a quiet edit.
    expect(TICKET_AFTER_SECONDS).toBeGreaterThanOrEqual(30);
  });
});
