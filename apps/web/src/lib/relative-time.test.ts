import { describe, expect, it } from "vitest";
import { formatRelativeTime, formatTimeUntil } from "./relative-time";

/**
 * `formatRelativeTime` measures how long AGO something happened. Handed a FUTURE timestamp
 * it computes a negative duration, lands in the `seconds < 45` branch and returns
 * "just now" — which is how the Scheduled-tasks page came to read "Next run just now" for a
 * run 8 hours away. `formatTimeUntil` exists for that direction.
 *
 * These tests pin BOTH the new behaviour and the past-only assumption that makes the split
 * necessary, so nobody merges them back together without noticing.
 */
const NOW = new Date("2026-10-16T12:00:00.000Z");

describe("formatTimeUntil", () => {
  it("counts forward in hours and days", () => {
    expect(formatTimeUntil("2026-10-16T20:00:00.000Z", NOW)).toBe("in 8h");
    expect(formatTimeUntil("2026-10-19T12:00:00.000Z", NOW)).toBe("in 3d");
  });

  it("counts forward in minutes below an hour", () => {
    expect(formatTimeUntil("2026-10-16T12:30:00.000Z", NOW)).toBe("in 30m");
    expect(formatTimeUntil("2026-10-16T12:00:30.000Z", NOW)).toBe("in under a minute");
  });

  it("says 'any moment now' for a time that has already passed", () => {
    // A nextRunAt in the past means the scheduler is due, not that time went backwards.
    expect(formatTimeUntil("2026-10-16T11:59:00.000Z", NOW)).toBe("any moment now");
    expect(formatTimeUntil("2026-10-16T12:00:00.000Z", NOW)).toBe("any moment now");
  });

  it("falls back to a date beyond a week", () => {
    expect(formatTimeUntil("2026-11-20T12:00:00.000Z", NOW)).toMatch(/Nov/);
  });

  it("returns empty for an unparseable value rather than 'Invalid Date'", () => {
    expect(formatTimeUntil("not-a-date", NOW)).toBe("");
  });

  it("never claims a future time is in the past", () => {
    // The exact regression: a future timestamp must not render as "just now".
    const out = formatTimeUntil("2026-10-17T00:30:00.000Z", NOW);
    expect(out).not.toBe("just now");
    expect(out).not.toMatch(/ago/);
  });
});

describe("formatRelativeTime stays past-only", () => {
  it("still renders past timestamps as expected", () => {
    expect(formatRelativeTime("2026-10-16T11:59:30.000Z", NOW)).toBe("just now");
    expect(formatRelativeTime("2026-10-16T11:30:00.000Z", NOW)).toBe("30m ago");
    expect(formatRelativeTime("2026-10-16T09:00:00.000Z", NOW)).toBe("3h ago");
    expect(formatRelativeTime("2026-10-14T12:00:00.000Z", NOW)).toBe("2d ago");
  });

  it("documents the trap: a FUTURE timestamp degrades to 'just now'", () => {
    // This is asserted so the reason for formatTimeUntil is recorded in code, not just in a
    // comment. If this ever changes, the split can be reconsidered.
    expect(formatRelativeTime("2026-10-16T20:00:00.000Z", NOW)).toBe("just now");
  });
});

describe("formatRelativeTime boundary", () => {
  const NOW = new Date("2026-10-16T12:00:00.000Z");
  const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000).toISOString();

  it("never prints a zero unit between the 'just now' and 'minutes' cutoffs", () => {
    // The regression: the "just now" cutoff is 45s but the next unit is MINUTES, so a 45-59s old
    // item computed `Math.floor(45/60) === 0` and rendered "0m ago" — measured on the live
    // Documents page, where a document created seconds earlier read "0 นาทีที่แล้ว".
    for (const s of [45, 50, 59]) {
      expect(formatRelativeTime(ago(s), NOW)).toBe("just now");
      expect(formatRelativeTime(ago(s), NOW)).not.toContain("0m");
    }
  });

  it("still switches to minutes once a full minute has passed", () => {
    expect(formatRelativeTime(ago(60), NOW)).toBe("1m ago");
    expect(formatRelativeTime(ago(90), NOW)).toBe("1m ago");
  });

  it("keeps the neighbouring thresholds unchanged", () => {
    expect(formatRelativeTime(ago(44), NOW)).toBe("just now");
    expect(formatRelativeTime(ago(60 * 60), NOW)).toBe("1h ago");
    expect(formatRelativeTime(ago(60 * 60 * 24), NOW)).toBe("1d ago");
  });
});
