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

import { EmployeeNav, EmployeeTabBar } from "./employee-nav";

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
  expect(rowTestIds(container)).toEqual(["work-nav-artifacts", "work-nav-usage"]);
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
  expect(ids).toEqual(["tab-chat", "tab-documents", "tab-usage"]);
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
