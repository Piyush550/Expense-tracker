import { describe, expect, it } from "vitest";
import { formatDateInput, lastDayOfMonth, parseDateInput } from "../shared/dates";

const today = "2026-10-20";
const p = (s: string, month?: string) => parseDateInput(s, { today, month });

describe("parseDateInput", () => {
  it("understands words for nearby days", () => {
    expect(p("today")).toBe("2026-10-20");
    expect(p("Yesterday")).toBe("2026-10-19");
    expect(p("tmrw")).toBe("2026-10-21");
  });

  it("puts a bare day in the month being viewed", () => {
    expect(p("21")).toBe("2026-10-21");
    expect(p("5", "2026-09")).toBe("2026-09-05");
    expect(p("21st", "2026-08")).toBe("2026-08-21");
    expect(p("31", "2026-09")).toBeNull(); // September has 30 days
  });

  it("reads day and month in any common form, day first", () => {
    for (const s of ["21 Oct", "21 october", "Oct 21", "21-oct", "21/10", "21-10", "21.10", "21 OCT."]) {
      expect(p(s), s).toBe("2026-10-21");
    }
    expect(p("3/4")).toBe("2026-04-03");
  });

  it("uses the viewed month's year, or else the most recent such date", () => {
    expect(p("28 Dec")).toBe("2025-12-28"); // typed in October: last December
    expect(p("15 Nov")).toBe("2026-11-15"); // within a month ahead stays this year
    expect(p("28 Dec", "2025-12")).toBe("2025-12-28");
    expect(p("2 Jan", "2027-01")).toBe("2027-01-02");
  });

  it("takes explicit years, short or long", () => {
    expect(p("21/10/26")).toBe("2026-10-21");
    expect(p("21 Oct 2024")).toBe("2024-10-21");
    expect(p("2026-10-21")).toBe("2026-10-21");
    expect(p("29/2/2028")).toBe("2028-02-29");
    expect(p("29/2/2027")).toBeNull();
  });

  it("rejects what it cannot read", () => {
    for (const s of ["", "hello", "32", "0", "21 Octx", "21 oct foo", "1/2/3/4", "13/13"]) expect(p(s), s).toBeNull();
  });
});

describe("date helpers", () => {
  it("formats and finds month ends", () => {
    expect(formatDateInput("2026-10-21")).toBe("21 Oct 2026");
    expect(lastDayOfMonth("2026-02")).toBe("2026-02-28");
    expect(lastDayOfMonth("2028-02")).toBe("2028-02-29");
    expect(lastDayOfMonth("2026-12")).toBe("2026-12-31");
  });
});
