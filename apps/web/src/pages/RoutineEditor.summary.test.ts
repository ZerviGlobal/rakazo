// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// Follow the sibling test's pattern: the component imports Lingui MACROS, which need the babel
// plugin that only the vite build provides. Mocking them keeps this a pure unit test of the
// summary. `t` joins the template parts, so assertions read the same as the rendered English.
vi.mock("@lingui/core/macro", () => ({
  t: (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((acc, part, i) => acc + part + (i < values.length ? String(values[i]) : ""), ""),
}));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ i18n: { locale: "en" } }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));

import { routineTriggerSummary } from "./RoutineEditor";
import type { Routine } from "@rakazo/contracts";

// `routineTriggerSummary` must produce text that passes through a CATALOG.
//
// It previously delegated to core's `formatCron`, which composes its phrase with plain template
// literals and no Lingui wiring — so a Thai employee read "Every day at 9:00 AM" on the
// Scheduled-tasks page (measured on a real account). The summary now builds the phrase here from
// core's STRUCTURED preset fields, which are translatable.
//
// These tests run with the default (English) catalog, so they pin the STRUCTURE: that each cron
// shape produces the expected phrase, and that nothing falls through to a raw cron unless the
// shape is genuinely "Advanced".

function routine(overrides: Partial<Routine> = {}): Routine {
  return {
    id: "r1",
    botId: "b1",
    name: "Test",
    prompt: "do a thing",
    crons: [],
    timezone: "UTC",
    active: true,
    webhookEnabled: false,
    githubEnabled: false,
    messageProvider: null,
    ...overrides,
  } as unknown as Routine;
}

describe("routineTriggerSummary", () => {
  it("states an inactive routine plainly", () => {
    expect(routineTriggerSummary(routine({ active: false }))).toBe("Paused");
  });

  it("describes each editor-shaped cron in words", () => {
    expect(routineTriggerSummary(routine({ crons: ["0 9 * * *"] }))).toBe("Every day at 9:00 AM");
    expect(routineTriggerSummary(routine({ crons: ["0 9 * * 1-5"] }))).toBe("Weekdays at 9:00 AM");
    expect(routineTriggerSummary(routine({ crons: ["0 9 * * 1"] }))).toBe("Every week at 9:00 AM");
    expect(routineTriggerSummary(routine({ crons: ["0 9 1 * *"] }))).toBe("Every month at 9:00 AM");
    expect(routineTriggerSummary(routine({ crons: ["0 * * * *"] }))).toBe("Every hour");
    expect(routineTriggerSummary(routine({ crons: ["*/15 * * * *"] }))).toBe("Every 15 minutes");
  });

  it("shows a raw cron for an Advanced schedule rather than inventing a phrase", () => {
    // A cron the presets cannot describe must not be mistranslated into a wrong sentence.
    const advanced = "5 3 2 6 4";
    expect(routineTriggerSummary(routine({ crons: [advanced] }))).toBe(advanced);
  });

  it("names a one-shot by its own label, not by the raw token", () => {
    expect(routineTriggerSummary(routine({ crons: ["@once"] }))).toBe("One-time");
  });

  it("joins multiple triggers and reports an empty schedule", () => {
    expect(routineTriggerSummary(routine({ crons: ["0 9 * * *", "0 * * * *"] }))).toBe(
      "Every day at 9:00 AM · Every hour",
    );
    expect(routineTriggerSummary(routine({ crons: [] }))).toBe("No trigger");
  });

  it("includes non-cron triggers alongside the schedule", () => {
    expect(routineTriggerSummary(routine({ crons: ["0 9 * * *"], webhookEnabled: true }))).toBe(
      "When a webhook fires · Every day at 9:00 AM",
    );
  });
});
