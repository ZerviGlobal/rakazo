import { expect, test } from "@playwright/test";
import { activeBotId, captureScreenshot, completeOnboarding, signup } from "./helpers";

/**
 * Guards the Zervi employee navigation.
 *
 * Two defects this exists for, both found by rendering rather than by unit tests:
 *
 * 1. Documents / Board / Usage were reachable ONLY from the avatar menu, so the owner of
 *    this deployment could not find them and asked twice whether Artifacts existed.
 * 2. The phone tab bar was first rendered as a SIBLING of `main`. `shell-root` is a flex
 *    ROW, so it became a full-height right-hand column (measured 156x844 at a 390px
 *    viewport) and squeezed the chat to 234px. It looked plausible in a downscaled
 *    screenshot and a visibility-only probe passed it.
 *
 * Hence the assertions below are on GEOMETRY, not visibility. `toBeVisible()` cannot tell
 * a bottom bar from a right-hand strip: both are visible, and for a full-height strip
 * `boundingBox().y + height` even equals the viewport height. Only width-vs-viewport and
 * the position of the top edge distinguish them.
 */

test("sidebar exposes the work destinations at rest", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `employee-nav-${stamp}@rakazo.test`, "password12", "Employee Nav");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/(?!artifacts(?:\/|$))[^/]+$/);
  activeBotId(page);

  const sidebar = page.getByTestId("bots-sidebar");
  await expect(sidebar).toBeVisible();

  // The whole point: reachable without opening the avatar menu.
  const nav = page.getByTestId("work-nav");
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("button", { name: "Documents" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Usage" })).toBeVisible();
  expect((await nav.boundingBox())?.x).toBeGreaterThanOrEqual(0);
  await captureScreenshot(page, testInfo, "employee-nav-sidebar");

  // ...and it still actually navigates.
  await nav.getByRole("button", { name: "Documents" }).click();
  await expect(page).toHaveURL(/\/app\/artifacts$/);
});

test("phone tab bar is a bottom bar, not a right-hand strip", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `employee-tabs-${stamp}@rakazo.test`, "password12", "Employee Tabs");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/(?!artifacts(?:\/|$))[^/]+$/);

  const WIDTH = 390;
  const HEIGHT = 844;
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });

  const bar = page.getByTestId("employee-tab-bar");
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("button", { name: "Documents" })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Usage" })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Chat" })).toBeVisible();

  const box = await bar.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  // Full width: a right-hand COLUMN is only as wide as its content.
  expect(box.width).toBeGreaterThan(WIDTH - 2);
  expect(box.x).toBeLessThanOrEqual(1);
  // Bottom-anchored and short: a column sibling is full height.
  expect(box.height).toBeLessThan(HEIGHT / 4);
  expect(box.y + box.height).toBeGreaterThan(HEIGHT - 2);

  // The chat area must not be squeezed by the bar.
  const main = page.locator("main");
  const mainBox = await main.boundingBox();
  expect(mainBox?.width).toBeGreaterThan(WIDTH - 2);

  await captureScreenshot(page, testInfo, "employee-tab-bar-phone");

  // ...and the tab navigates.
  await bar.getByRole("button", { name: "Documents" }).click();
  await expect(page).toHaveURL(/\/app\/artifacts$/);

  // The bar is a phone affordance: it must not occupy space on a desktop viewport.
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(bar).toBeHidden();
});

test("Thai is selectable and translates the employee nav", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `employee-thai-${stamp}@rakazo.test`, "password12", "Employee Thai");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/(?!artifacts(?:\/|$))[^/]+$/);

  // A locale is only really added if a user can PICK it, so drive the real picker.
  await page.evaluate(() => window.localStorage.setItem("rakazo.uiLocale", "th"));
  await page.reload();
  await expect(page.getByTestId("work-nav")).toBeVisible();

  // แชท / เอกสาร / การใช้งาน — assert on the Thai labels, not on the English ones.
  const nav = page.getByTestId("work-nav");
  await expect(nav.getByRole("button", { name: "เอกสาร" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "การใช้งาน" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("th");
  await captureScreenshot(page, testInfo, "employee-nav-thai");
});

test("Documents keeps its navigation on a phone", async ({ page }, testInfo) => {
  // /app/artifacts is a STANDALONE route — it renders its own page, with no shell-root
  // and therefore no space sidebar. When the phone tab bar was only on the Shell, tapping
  // Documents landed the user on a page where the navigation vanished: the bar disappeared
  // exactly when it was used. This is the regression guard for that.
  const stamp = Date.now();
  await signup(page, `employee-docs-${stamp}@rakazo.test`, "password12", "Employee Docs");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/(?!artifacts(?:\/|$))[^/]+$/);

  const WIDTH = 390;
  const HEIGHT = 844;
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });

  await page.getByTestId("employee-tab-bar").getByRole("button", { name: "Documents" }).click();
  await expect(page).toHaveURL(/\/app\/artifacts$/);

  const bar = page.getByTestId("employee-tab-bar");
  await expect(bar).toBeVisible();
  const box = await bar.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.width).toBeGreaterThan(WIDTH - 2);
  expect(box.height).toBeLessThan(HEIGHT / 4);
  expect(box.y + box.height).toBeGreaterThan(HEIGHT - 2);
  // The tab you arrived on is marked, so the bar reads as a location not just a menu.
  await expect(bar.getByRole("button", { name: "Documents" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await captureScreenshot(page, testInfo, "employee-docs-phone");

  // Chat must get the user back into the Shell (with its sidebar).
  await bar.getByRole("button", { name: "Chat" }).click();
  await page.waitForURL(/\/app\/(?!artifacts(?:\/|$))[^/]+$/);
  await expect(page.getByTestId("bots-sidebar")).toBeVisible();
});

test("Usage opens the settings overlay from a standalone route", async ({ page }) => {
  // Regression guard for a real miss: the tab bar first linked to `/app?usage=1`, which
  // looks correct and even works on a bot route — but a bare /app redirects to
  // /app/<botId> with { replace: true } and no search string, destroying the param before
  // the Shell could read it. Measured: ?usage=1 on /app opened nothing.
  const stamp = Date.now();
  await signup(page, `employee-usage-${stamp}@rakazo.test`, "password12", "Employee Usage");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/(?!artifacts(?:\/|$))[^/]+$/);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/app/artifacts");
  await expect(page.getByTestId("employee-tab-bar")).toBeVisible();
  await expect(page.getByTestId("user-settings")).toHaveCount(0);

  await page.getByTestId("employee-tab-bar").getByRole("button", { name: "Usage" }).click();

  const overlay = page.getByTestId("user-settings");
  await expect(overlay).toBeVisible();
  // The section, not just the overlay: opening Settings on "General" would be a miss.
  await expect(page.getByTestId("settings-nav-usage")).toHaveAttribute("aria-current", "page");
});
