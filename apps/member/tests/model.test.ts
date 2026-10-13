import { describe, expect, it } from "vitest";
import {
  seed,
  probabilityTotal,
  selectPrize,
  validateTip,
  safeLink,
} from "../src/model";
import { screens, screenPath } from "../src/registry";
describe("screen catalogue", () => {
  it("contains every supplied member and administrator ID exactly once", () => {
    const expected = [
      ...Array.from(
        { length: 109 },
        (_, i) => `U${String(i + 1).padStart(3, "0")}`,
      ),
      ...Array.from(
        { length: 95 },
        (_, i) => `A${String(i + 1).padStart(3, "0")}`,
      ),
    ];
    expect(screens.map((s) => s.id).sort()).toEqual(expected.sort());
    expect(new Set(screens.map((s) => s.id)).size).toBe(204);
    for (const screen of screens) expect(screenPath(screen.id)).toMatch(/^\//);
  });
});
describe("free ticket draw", () => {
  it("selects prizes at probability boundaries without preferring a result", () => {
    expect(probabilityTotal(seed.probabilities)).toBe(100);
    expect(selectPrize(seed.probabilities, 0).rarity).toBe("SSR");
    expect(selectPrize(seed.probabilities, 0.049999).rarity).toBe("SSR");
    expect(selectPrize(seed.probabilities, 0.05).rarity).toBe("SR");
    expect(selectPrize(seed.probabilities, 0.3).rarity).toBe("R");
    expect(selectPrize(seed.probabilities, 0.999999).rarity).toBe("R");
  });
  it("rejects invalid probability tables and invalid randomness", () => {
    expect(() =>
      selectPrize([{ ...seed.probabilities[0], weight: 99 }], 0.5),
    ).toThrow();
    expect(() =>
      selectPrize(
        [
          { ...seed.probabilities[0], weight: -1 },
          { ...seed.probabilities[1], weight: 101 },
        ],
        0.5,
      ),
    ).toThrow();
    expect(() => selectPrize(seed.probabilities, 1)).toThrow();
    expect(() => selectPrize(seed.probabilities, -1)).toThrow();
  });
});
describe("payment amount and links", () => {
  it("accepts only integer yen within limits", () => {
    expect(validateTip(100, 10000)).toBe(true);
    expect(validateTip(10000, 10000)).toBe(true);
    for (const amount of [0, 99, -100, 10001, 500.5, NaN, Infinity])
      expect(validateTip(amount, 10000)).toBe(false);
  });
  it("rejects unsafe external link protocols", () => {
    expect(safeLink("https://www.youtube.com/")).toBe(
      "https://www.youtube.com/",
    );
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,test",
      "file:///C:/secret",
      "http://example.com",
      "not-a-url",
    ])
      expect(safeLink(url)).toBeNull();
  });
});
