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
