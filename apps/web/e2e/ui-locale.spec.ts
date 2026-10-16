import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, openUserSettings, signup } from "./helpers";

test("account settings language picker includes Simplified Chinese and applies it", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `ui-locale-zh-cn-${stamp}@rakazo.test`, "password12", "Locale QA");
  await completeOnboarding(page, testInfo);

  const settings = await openUserSettings(page);
  await expect(settings.getByRole("heading", { name: "General", exact: true })).toBeVisible();
  await expect(settings.getByRole("heading", { name: "Language", exact: true })).toBeVisible();

  const picker = settings.getByTestId("ui-locale-select");
  await picker.click();
  await expect(settings.getByRole("option", { name: "简体中文", exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "ui-locale-picker-zh-cn");

  await settings.getByRole("option", { name: "简体中文", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "账户", exact: true })).toBeVisible();
  await expect(settings.getByRole("heading", { name: "语言", exact: true })).toBeVisible();
  await expect(picker).toHaveText("简体中文");
  await captureScreenshot(page, testInfo, "ui-locale-settings-zh-cn");
});

test("account settings language picker includes Korean and applies it", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `ui-locale-ko-${stamp}@rakazo.test`, "password12", "Locale QA");
  await completeOnboarding(page, testInfo);

  const settings = await openUserSettings(page);
  await expect(settings.getByRole("heading", { name: "General", exact: true })).toBeVisible();
  await expect(settings.getByRole("heading", { name: "Language", exact: true })).toBeVisible();

  const picker = settings.getByTestId("ui-locale-select");
  await picker.click();
  await expect(settings.getByRole("option", { name: "한국어", exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "ui-locale-picker-ko");

  await settings.getByRole("option", { name: "한국어", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "계정", exact: true })).toBeVisible();
  await expect(settings.getByRole("heading", { name: "언어", exact: true })).toBeVisible();
  await expect(picker).toHaveText("한국어");
  await captureScreenshot(page, testInfo, "ui-locale-settings-ko");
});

test("account settings language picker includes Spanish and applies it", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `ui-locale-es-${stamp}@rakazo.test`, "password12", "Locale QA");
  await completeOnboarding(page, testInfo);

  const settings = await openUserSettings(page);
  await expect(settings.getByRole("heading", { name: "General", exact: true })).toBeVisible();
  await expect(settings.getByRole("heading", { name: "Language", exact: true })).toBeVisible();

  const picker = settings.getByTestId("ui-locale-select");
  await picker.click();
  await expect(settings.getByRole("option", { name: "Español", exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "ui-locale-picker-es");

  await settings.getByRole("option", { name: "Español", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "Cuenta", exact: true })).toBeVisible();
  await expect(settings.getByRole("heading", { name: "Idioma", exact: true })).toBeVisible();
  await expect(picker).toHaveText("Español");
  await captureScreenshot(page, testInfo, "ui-locale-settings-es");
});

test("account settings language picker includes Russian and persists it", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `ui-locale-ru-${stamp}@rakazo.test`, "password12", "Locale QA");
  await completeOnboarding(page, testInfo);

  await page.getByTestId("user-menu-trigger").click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByTestId("user-settings");
  await expect(settings).toBeVisible();

  const picker = settings.getByTestId("ui-locale-select");
  await picker.click();
  await expect(settings.getByRole("option", { name: "Русский", exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "ui-locale-picker-ru");

  await settings.getByRole("option", { name: "Русский", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "Общие", exact: true })).toBeVisible();
  await expect(settings.getByRole("heading", { name: "Язык", exact: true })).toBeVisible();
  await expect(picker).toHaveText("Русский");
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await captureScreenshot(page, testInfo, "ui-locale-settings-ru");
});

test("account settings language picker includes French and persists it", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `ui-locale-fr-${stamp}@rakazo.test`, "password12", "Locale QA");
  await completeOnboarding(page, testInfo);

  await page.getByTestId("user-menu-trigger").click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByTestId("user-settings");
  await expect(settings).toBeVisible();

  const picker = settings.getByTestId("ui-locale-select");
  await picker.click();
  await expect(settings.getByRole("option", { name: "Français", exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "ui-locale-picker-fr");

  await settings.getByRole("option", { name: "Français", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "Général", exact: true })).toBeVisible();
  await expect(settings.getByRole("heading", { name: "Compte", exact: true })).toBeVisible();
  await expect(settings.getByRole("heading", { name: "Langue", exact: true })).toBeVisible();
  await expect(picker).toHaveText("Français");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await captureScreenshot(page, testInfo, "ui-locale-settings-fr");
});

// Thai follows the same pattern as the locales above. It was the ONE locale the Zervi work added
// and the only one without a spec, so the path an employee actually uses to switch language —
// Settings -> Language -> picker -> reload — was untested for it.
//
// Thai matters more than the others here: the staff this is for are in Chonburi, and the app has
// no server-side locale, so this picker (or the browser language) is the only way they get Thai.
test("account settings language picker includes Thai and persists it", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `ui-locale-th-${stamp}@rakazo.test`, "password12", "Locale QA");
  await completeOnboarding(page, testInfo);

  await page.getByTestId("user-menu-trigger").click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByTestId("user-settings");
  await expect(settings).toBeVisible();

  const picker = settings.getByTestId("ui-locale-select");
  await picker.click();
  await expect(settings.getByRole("option", { name: "ไทย", exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "ui-locale-picker-th");

  await settings.getByRole("option", { name: "ไทย", exact: true }).click();
  // "ทั่วไป" is Thai for "General" — the Settings heading, so this proves Thai actually rendered
  // rather than merely being selected.
  await expect(settings.getByRole("heading", { name: "ทั่วไป", exact: true })).toBeVisible();
  await expect(picker).toHaveText("ไทย");
  await expect(page.locator("html")).toHaveAttribute("lang", "th");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "th");
  await captureScreenshot(page, testInfo, "ui-locale-settings-th");
});
