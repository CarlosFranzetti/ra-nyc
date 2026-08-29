import { describe, expect, it } from "vitest";
import {
  MAX_RECENT,
  loadRecent,
  remember,
  saveRecent,
} from "../../src/lib/recentSearches";

/** A localStorage stand-in that can also be told to fail. */
function fakeStorage(initial?: string, fail = false) {
  let value = initial;
  return {
    getItem: () => {
      if (fail) throw new Error("denied");
      return value ?? null;
    },
    setItem: (_key: string, next: string) => {
      if (fail) throw new Error("quota");
      value = next;
    },
    read: () => value,
  };
}

describe("remember", () => {
  it("puts the newest search first", () => {
    expect(remember(["nowadays"], "bossa")).toEqual(["bossa", "nowadays"]);
  });

  it("keeps at most six", () => {
    let list: string[] = [];
    for (const term of ["a1", "b2", "c3", "d4", "e5", "f6", "g7", "h8"]) {
      list = remember(list, term);
    }
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0]).toBe("h8");
    // The two oldest fell off the end, not off the front.
    expect(list).not.toContain("a1");
    expect(list).not.toContain("b2");
  });

  it("moves a repeat to the front instead of listing it twice", () => {
    const list = remember(remember(["x", "matias"], "y"), "matias");
    expect(list).toEqual(["matias", "y", "x"]);
  });

  it("treats a differently-cased repeat as the same search", () => {
    // And keeps the *new* spelling: what you last typed is what you will
    // recognise, so this reads "Matias" rather than the older "matias".
    expect(remember(["matias"], "Matias")).toEqual(["Matias"]);
  });

  it("ignores blank input rather than banking an empty row", () => {
    expect(remember(["a"], "   ")).toEqual(["a"]);
    expect(remember([], "")).toEqual([]);
  });

  it("stores the trimmed term", () => {
    expect(remember([], "  bossa nova  ")).toEqual(["bossa nova"]);
  });
});

describe("loadRecent", () => {
  it("reads back what was written", () => {
    const storage = fakeStorage();
    saveRecent(storage, ["one", "two"]);
    expect(loadRecent(storage)).toEqual(["one", "two"]);
  });

  it("returns nothing when there is no storage at all", () => {
    expect(loadRecent(null)).toEqual([]);
  });

  it("survives storage that throws, as Safari's private mode does", () => {
    expect(loadRecent(fakeStorage(undefined, true))).toEqual([]);
    // And a failed write is silent rather than fatal.
    expect(() => saveRecent(fakeStorage(undefined, true), ["x"])).not.toThrow();
  });

  it("discards junk instead of rendering it", () => {
    // localStorage is shared with the user and with older builds, so its
    // contents are input rather than state.
    expect(loadRecent(fakeStorage("not json"))).toEqual([]);
    expect(loadRecent(fakeStorage('{"a":1}'))).toEqual([]);
    expect(loadRecent(fakeStorage('[1, null, "ok", "  ", "fine"]'))).toEqual([
      "ok",
      "fine",
    ]);
  });

  it("caps an over-long stored list", () => {
    const stored = JSON.stringify(["1", "2", "3", "4", "5", "6", "7", "8"]);
    expect(loadRecent(fakeStorage(stored))).toHaveLength(MAX_RECENT);
  });
});
