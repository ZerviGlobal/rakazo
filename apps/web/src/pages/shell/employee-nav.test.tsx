// @vitest-environment jsdom
//
// Pins the Zervi employee-navigation contract. The defect this guards against is
// discoverability, not rendering: Documents/Board/Usage existed and worked, but
// were reachable only through the avatar menu, so the deployment owner could not
// find them. If someone removes these rows, that regression returns silently.

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray) => parts.join("");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});

import {
  EmployeeNav,
  EmployeeTabBar,
  requestSettingsSection,
  takePendingSettingsSection,
} from "./employee-nav";

function render(ui: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return { container, root };
}

function rowTestIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[data-testid^='work-nav-']")].map(
    (el) => el.getAttribute("data-testid") ?? "",
  );
}

it("shows Documents and Usage to every user, whether or not the board is enabled", () => {
  const { container } = render(
    <EmployeeNav boardEnabled={false} onNavigate={() => {}} onOpenUsage={() => {}} />,
  );
  expect(rowTestIds(container)).toEqual([
    "work-nav-artifacts",
    "work-nav-routines",
    "work-nav-usage",
  ]);
});

it("shows Board only when the ticket board is enabled", () => {
  const on = render(<EmployeeNav boardEnabled onNavigate={() => {}} onOpenUsage={() => {}} />);
  expect(rowTestIds(on.container)).toContain("work-nav-board");

  const off = render(
    <EmployeeNav boardEnabled={false} onNavigate={() => {}} onOpenUsage={() => {}} />,
  );
  expect(rowTestIds(off.container)).not.toContain("work-nav-board");
});

it("navigates Documents to the artifacts route", () => {
  const onNavigate = vi.fn();
  const { container } = render(
    <EmployeeNav boardEnabled={false} onNavigate={onNavigate} onOpenUsage={() => {}} />,
  );
  const button = container.querySelector("[data-testid='work-nav-artifacts']");
  expect(button?.textContent).toBe("Documents");
  act(() => (button as HTMLButtonElement).click());
  expect(onNavigate).toHaveBeenCalledWith("/app/artifacts");
});

it("routes Usage to the settings callback rather than a path, because it has no route", () => {
  const onNavigate = vi.fn();
  const onOpenUsage = vi.fn();
  const { container } = render(
    <EmployeeNav boardEnabled={false} onNavigate={onNavigate} onOpenUsage={onOpenUsage} />,
  );
  act(() =>
    (container.querySelector("[data-testid='work-nav-usage']") as HTMLButtonElement).click(),
  );
  expect(onOpenUsage).toHaveBeenCalledTimes(1);
  expect(onNavigate).not.toHaveBeenCalled();
});

it("gives a phone the same destinations the desktop sidebar has", () => {
  // On a 390px screen the sidebar is closed at rest, so without this bar the Work
  // destinations are back behind the hamburger — the defect this change fixes.
  const { container } = render(
    <EmployeeTabBar
      boardEnabled={false}
      activePath="/app"
      onNavigate={() => {}}
      onOpenUsage={() => {}}
      onOpenChat={() => {}}
    />,
  );
  const ids = [...container.querySelectorAll("[data-testid^='tab-']")].map((e) =>
    e.getAttribute("data-testid"),
  );
  expect(ids).toEqual(["tab-chat", "tab-documents", "tab-routines", "tab-usage"]);
});

it("marks the active tab so the phone shows where you are", () => {
  const { container } = render(
    <EmployeeTabBar
      boardEnabled
      activePath="/app/artifacts"
      onNavigate={() => {}}
      onOpenUsage={() => {}}
      onOpenChat={() => {}}
    />,
  );
  const docs = container.querySelector("[data-testid='tab-documents']");
  const chat = container.querySelector("[data-testid='tab-chat']");
  expect(docs?.getAttribute("aria-current")).toBe("page");
  expect(chat?.getAttribute("aria-current")).toBeNull();
});

it("routes the phone Usage tab to settings, not a path", () => {
  const onNavigate = vi.fn();
  const onOpenUsage = vi.fn();
  const { container } = render(
    <EmployeeTabBar
      boardEnabled={false}
      activePath="/app"
      onNavigate={onNavigate}
      onOpenUsage={onOpenUsage}
      onOpenChat={() => {}}
    />,
  );
  act(() => (container.querySelector("[data-testid='tab-usage']") as HTMLButtonElement).click());
  expect(onOpenUsage).toHaveBeenCalledTimes(1);
  expect(onNavigate).not.toHaveBeenCalled();
});

it("hands a settings request across the route boundary, and consumes it once", async () => {
  // A query param cannot carry this: a bare /app redirects to /app/<botId> with
  // { replace: true } and no search string, so the param is destroyed before the Shell
  // reads it (measured). sessionStorage survives that redirect.
  const store = new Map<string, string>();
  const original = window.sessionStorage;
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
  try {
    expect(takePendingSettingsSection()).toBeNull();
    requestSettingsSection("usage");
    // Read-and-clear: a second read must not re-open the overlay on every mount.
    expect(takePendingSettingsSection()).toBe("usage");
    expect(takePendingSettingsSection()).toBeNull();
  } finally {
    Object.defineProperty(window, "sessionStorage", { configurable: true, value: original });
  }
});

it("does not throw when session storage is unavailable", () => {
  const original = window.sessionStorage;
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    get: () => {
      throw new Error("storage disabled");
    },
  });
  try {
    // Must not fail the tap just because the browser blocks storage.
    expect(() => requestSettingsSection("usage")).not.toThrow();
    expect(takePendingSettingsSection()).toBeNull();
  } finally {
    Object.defineProperty(window, "sessionStorage", { configurable: true, value: original });
  }
});

it("offers a visible way to create a department", () => {
  // Upstream reaches sections only via right-click -> Move to -> New section, which is
  // undiscoverable on desktop and IMPOSSIBLE on a phone (no right-click, and the bot row
  // carries no menu button — measured). This is the visible, tappable entry point.
  const onCreateDepartment = vi.fn();
  const { container } = render(
    <EmployeeNav
      boardEnabled={false}
      onNavigate={() => {}}
      onOpenUsage={() => {}}
      onCreateDepartment={onCreateDepartment}
    />,
  );
  const button = container.querySelector("[data-testid='work-nav-new-department']");
  expect(button).not.toBeNull();
  expect(button?.textContent).toBe("New department");
  act(() => (button as HTMLButtonElement).click());
  expect(onCreateDepartment).toHaveBeenCalledTimes(1);
});

it("hides the department action where creating one is not possible", () => {
  // Standalone routes have no bot to attach a section to, so the action must not appear
  // as a dead control.
  const { container } = render(
    <EmployeeNav boardEnabled={false} onNavigate={() => {}} onOpenUsage={() => {}} />,
  );
  expect(container.querySelector("[data-testid='work-nav-new-department']")).toBeNull();
});

it("gives the sidebar nav and the phone tab bar different accessible names", () => {
  // Both live in the DOM at once (only one is visible per viewport width), so identical
  // names make two ambiguous navigation landmarks for a screen reader. Measured with
  // Accessibility.getFullAXTree: both were exposed as "Work".
  const nav = render(<EmployeeNav boardEnabled={false} onNavigate={() => {}} onOpenUsage={() => {}} />);
  const tabs = render(
    <EmployeeTabBar
      boardEnabled={false}
      activePath="/app"
      onNavigate={() => {}}
      onOpenUsage={() => {}}
      onOpenChat={() => {}}
    />,
  );
  const sidebarName = nav.container.querySelector("nav")?.getAttribute("aria-label");
  const tabBarName = tabs.container.querySelector("nav")?.getAttribute("aria-label");
  expect(sidebarName).toBeTruthy();
  expect(tabBarName).toBeTruthy();
  expect(sidebarName).not.toBe(tabBarName);
});

it("labels every nav control, so no icon-only button is unlabelled", () => {
  // Upstream's accessibility discipline (zero unlabelled icon buttons) must survive
  // additions; each row here shows text, so none may be icon-only.
  const { container } = render(
    <EmployeeNav
      boardEnabled
      onNavigate={() => {}}
      onOpenUsage={() => {}}
      onCreateDepartment={() => {}}
    />,
  );
  for (const button of container.querySelectorAll("button")) {
    const hasText = (button.textContent ?? "").trim().length > 0;
    const hasAria = !!button.getAttribute("aria-label");
    expect(hasText || hasAria).toBe(true);
  }
});
