import { describe, expect, it } from "vitest";
import { normalizeDateFields, sniffDates } from "../src/dates.js";

const rows = (...renewals: string[]) => renewals.map((renewal_on) => ({ id: "a1", renewal_on }));
const warnBox: string[] = [];
const warn = (m: string) => warnBox.push(m);
const FIELDS = ["renewal_on"];

describe("sniffDates", () => {
  it("returns null format for ISO-only files", () => {
    expect(sniffDates(rows("2026-10-01", "2026-11-15"), FIELDS).format).toBeNull();
  });
  it("detects EU when any first component > 12", () => {
    const s = sniffDates(rows("25/12/2026", "01/10/2026"), FIELDS);
    expect(s.format).toBe("eu");
    expect(s.mixed).toBe(false);
  });
  it("detects US when any second component > 12", () => {
    const s = sniffDates(rows("10/25/2026"), FIELDS);
    expect(s.format).toBe("us");
  });
  it("flags mixed files where both orders are provable", () => {
    const s = sniffDates(rows("25/12/2026", "10/25/2026"), FIELDS);
    expect(s.mixed).toBe(true);
  });
  it("counts ambiguous dates with no proof either way", () => {
    const s = sniffDates(rows("01/10/2026", "05/03/2026"), FIELDS);
    expect(s.format).toBe("us"); // default assumption
    expect(s.ambiguous).toBe(2);
    expect(s.example).toBe("01/10/2026");
  });
});

describe("normalizeDateFields", () => {
  it("converts provably-EU slash dates to ISO and warns once", () => {
    warnBox.length = 0;
    const out = normalizeDateFields(rows("25/12/2026", "01/10/2026"), FIELDS, "accounts.csv", warn);
    expect(out.map((r) => r.renewal_on)).toEqual(["2026-12-25", "2026-10-01"]);
    expect(warnBox).toHaveLength(1);
    expect(warnBox[0]).toContain("DD/MM/YYYY");
  });
  it("assumes MM/DD for ambiguous files but says so", () => {
    warnBox.length = 0;
    const out = normalizeDateFields(rows("01/10/2026"), FIELDS, "accounts.csv", warn);
    expect(out[0].renewal_on).toBe("01/10/2026"); // left for Date.parse (US)
    expect(warnBox[0]).toContain("assumed MM/DD/YYYY");
  });
  it("leaves mixed files untouched with a loud warning", () => {
    warnBox.length = 0;
    const out = normalizeDateFields(rows("25/12/2026", "10/25/2026"), FIELDS, "accounts.csv", warn);
    expect(out[0].renewal_on).toBe("25/12/2026");
    expect(warnBox[0]).toContain("mixed date formats");
  });
  it("never warns on clean ISO files", () => {
    warnBox.length = 0;
    normalizeDateFields(rows("2026-10-01"), FIELDS, "accounts.csv", warn);
    expect(warnBox).toHaveLength(0);
  });
  it("handles empty input", () => {
    warnBox.length = 0;
    expect(normalizeDateFields([], FIELDS, "accounts.csv", warn)).toEqual([]);
    expect(warnBox).toHaveLength(0);
  });
});
