// Thai (th) is the Zervi adoption case: the shop floor is in Chonburi and the app
// shipped 10 locales without Thai. These tests pin the three places a locale has to
// be registered — the list, the normalizer, and the speech tag — plus the fact that
// an untranslated string falls back to English rather than rendering blank.

import { expect, it } from "vitest";
import { speechLocaleTag } from "./dictation";
import { UI_LOCALES, UI_LOCALE_LABELS, isUiLocale, normalizeUiLocale } from "./ui-locale";

it("offers Thai as a selectable locale", () => {
  expect(UI_LOCALES).toContain("th");
  expect(isUiLocale("th")).toBe(true);
  expect(UI_LOCALE_LABELS.th).toBe("ไทย");
});

it("keeps every locale labelled, so the picker cannot render an empty row", () => {
  for (const locale of UI_LOCALES) {
    expect(UI_LOCALE_LABELS[locale]?.length ?? 0).toBeGreaterThan(0);
  }
  expect(Object.keys(UI_LOCALE_LABELS).sort()).toEqual([...UI_LOCALES].sort());
});

it("normalizes Thai region tags to th, and still falls back to en for unknown", () => {
  expect(normalizeUiLocale("th")).toBe("th");
  expect(normalizeUiLocale("th-TH")).toBe("th");
  expect(normalizeUiLocale("TH")).toBe("th");
  expect(normalizeUiLocale("th_TH")).toBe("th");
  expect(normalizeUiLocale("xx-YY")).toBe("en");
});

it("gives dictation the BCP-47 tag the recognizer needs for Thai", () => {
  expect(speechLocaleTag("th")).toBe("th-TH");
});
