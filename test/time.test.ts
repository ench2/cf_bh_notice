import { describe, expect, it } from "vitest";
import { addInterval } from "../src/time";

describe("addInterval", () => {
  it("adds minute, hour, and day intervals", () => {
    expect(addInterval("2026-06-18T00:00:00.000Z", 5, "minute")).toBe("2026-06-18T00:05:00.000Z");
    expect(addInterval("2026-06-18T00:00:00.000Z", 2, "hour")).toBe("2026-06-18T02:00:00.000Z");
    expect(addInterval("2026-06-18T00:00:00.000Z", 1, "day")).toBe("2026-06-19T00:00:00.000Z");
  });

  it("clamps overflowing month dates to the last day", () => {
    expect(addInterval("2025-01-31T08:30:00.000Z", 1, "month")).toBe("2025-02-28T08:30:00.000Z");
    expect(addInterval("2024-01-31T08:30:00.000Z", 1, "month")).toBe("2024-02-29T08:30:00.000Z");
  });

  it("clamps overflowing leap-day year dates to the last day", () => {
    expect(addInterval("2024-02-29T08:30:00.000Z", 1, "year")).toBe("2025-02-28T08:30:00.000Z");
  });
});
