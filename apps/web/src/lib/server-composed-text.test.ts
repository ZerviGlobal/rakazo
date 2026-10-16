// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// Lingui macros need the babel plugin only the vite build provides — same mock as sibling tests.
// The mock returns the EN catalog, so a matched sentence comes back unchanged in English. That makes
// the assertions below about MATCHING (the translated value is exercised live), not about wording.
vi.mock("@lingui/core/macro", () => ({
  t: (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((acc, part, i) => acc + part + (i < values.length ? String(values[i]) : ""), ""),
}));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ i18n: { locale: "en" } }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));

import { translateApiComposedText } from "../pages/Shell";

// These sentences are composed by the API, so they bypass the i18n catalog BY CONSTRUCTION; the
// client maps them back. A regex that silently stops matching would revert to English with no error,
// which is why the INTERPOLATED forms are pinned here — those are the ones an exact match cannot cover.
describe("translateApiComposedText", () => {
  it("never touches model output or user-typed text", () => {
    const thai = "สวัสดีครับ ผมช่วยงานได้หลายอย่าง";
    expect(translateApiComposedText(thai)).toBe(thai);
    expect(translateApiComposedText("Your factory is in Chonburi.")).toBe("Your factory is in Chonburi.");
  });

  it("preserves the INTERPOLATED value when it matches a composed sentence", () => {
    // If the regex broke, the placeholder would be lost or the sentence left unmatched — either way
    // the app name must survive, because it is the user-facing label the sentence is ABOUT.
    const appNames = "Slack, Gmail, and Google Calendar";
    const out = translateApiComposedText(
      `${appNames} are a good place to start. Connect them here and I’ll use what you already have.`,
    );
    expect(out).toContain(appNames);
  });

  it("keeps the model id and the count in the runtime status lines", () => {
    expect(translateApiComposedText("Provider unavailable. Switched to backup model gpt-5."))
      .toContain("gpt-5");
    expect(translateApiComposedText("Stopped: more than 40 tool calls in one turn.")).toContain("40");
    expect(translateApiComposedText("Unknown model deepseek/deepseek-v4-pro"))
      .toContain("deepseek/deepseek-v4-pro");
    expect(translateApiComposedText("browser is unavailable without an executor."))
      .toContain("browser");
  });
});
