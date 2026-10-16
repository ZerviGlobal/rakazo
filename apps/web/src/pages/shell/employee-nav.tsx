import { Trans, useLingui } from "@lingui/react/macro";
import {
  CalendarClock,
  FolderOpen,
  FolderPlus,
  Gauge,
  MessageSquare,
  SquareKanban,
} from "lucide-react";

/**
 * Cross-route handoff for "open the Usage section", used by the phone tab bar.
 *
 * WHY NOT A QUERY PARAM: the tab bar lives on standalone routes (/app/artifacts,
 * /app/board) and has to reach the settings overlay, which lives in the Shell. A
 * `/app?usage=1` param looks right and even works on a bot route — but the Shell
 * redirects a bare `/app` to `/app/<botId>` with `{ replace: true }` and no search
 * string, so the param is destroyed before the handler runs. Measured: `?usage=1` on
 * `/app` opened nothing, while the same param on a bot route opened the Usage section.
 *
 * Session storage survives that redirect and is scoped to the tab, so the intent arrives
 * without changing a shared upstream redirect.
 */
const PENDING_SETTINGS_SECTION_KEY = "rakazo:pending-settings-section";

/** Ask the Shell to open the settings overlay on a section. Safe to call off-route. */
export function requestSettingsSection(section: "usage"): void {
  try {
    window.sessionStorage.setItem(PENDING_SETTINGS_SECTION_KEY, section);
  } catch {
    // Storage unavailable (private mode); the navigation still lands, the overlay just
    // does not auto-open. Not worth failing the tap over.
  }
}

/** Read and clear the pending request. Returns null when there is none. */
export function takePendingSettingsSection(): "usage" | null {
  try {
    const value = window.sessionStorage.getItem(PENDING_SETTINGS_SECTION_KEY);
    if (value) window.sessionStorage.removeItem(PENDING_SETTINGS_SECTION_KEY);
    return value === "usage" ? "usage" : null;
  } catch {
    return null;
  }
}

/**
 * Zervi employee navigation.
 *
 * WHY THIS EXISTS (measured 2026-10-16): Documents (upstream "Artifacts"), Board
 * and Usage were reachable ONLY through the avatar menu — two clicks, invisible
 * at rest. The owner of this deployment could not find Artifacts and asked twice
 * whether the feature existed. The feature set was complete; the
 * discoverability was not.
 *
 * This block is deliberately additive: it adds entry points to the space
 * sidebar and changes no route, no RPC and no data model. Upstream names stay
 * untouched internally; only the labels a Zervi employee reads are changed
 * (Artifacts -> Documents).
 *
 * NOT included, and why: "Scheduled tasks" (routines) has no global route in
 * this build — routines are listed inside a bot's context panel and
 * `rpc.routines.list` takes a botId. A sidebar link would be swallowed by the
 * `/app/:botId` route and open a bogus bot. It needs a real page first; that is
 * a separate increment, not a label.
 */
export function EmployeeNav({
  boardEnabled,
  onNavigate,
  onOpenUsage,
  onCreateDepartment,
}: {
  boardEnabled: boolean;
  /** Chosen destination path; the caller navigates and closes the mobile sidebar. */
  onNavigate: (path: string) => void;
  /** Usage is a settings-overlay section, not a route. */
  onOpenUsage: () => void;
  /** Omitted where a department cannot be created (e.g. a standalone route with no bot). */
  onCreateDepartment?: () => void;
}) {
  const { t } = useLingui();
  const rows = [
    {
      testId: "work-nav-artifacts",
      label: <Trans>Documents</Trans>,
      icon: FolderOpen,
      onClick: () => onNavigate("/app/artifacts"),
      hidden: false,
    },
    {
      testId: "work-nav-routines",
      label: <Trans>Scheduled tasks</Trans>,
      icon: CalendarClock,
      onClick: () => onNavigate("/app/routines"),
      hidden: false,
    },
    {
      testId: "work-nav-board",
      label: <Trans>Board</Trans>,
      icon: SquareKanban,
      onClick: () => onNavigate("/app/board"),
      hidden: !boardEnabled,
    },
    {
      testId: "work-nav-usage",
      label: <Trans>Usage</Trans>,
      icon: Gauge,
      onClick: onOpenUsage,
      hidden: false,
    },
  ].filter((row) => !row.hidden);

  return (
    <nav
      data-testid="work-nav"
      // Distinct from the phone bar's label: two navigation landmarks sharing one name is
      // ambiguous to a screen reader (both exist in the DOM; only one is visible per width).
      aria-label={t`Work destinations`}
      className="mx-3 mb-1"
    >      <div className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground/70">
        <Trans>Work</Trans>
      </div>
      {rows.map((row) => {
        const Icon = row.icon;
        return (
          <button
            key={row.testId}
            type="button"
            data-testid={row.testId}
            onClick={row.onClick}
            className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-sidebar-accent"
          >
            <span className="grid h-[30px] w-[30px] place-items-center rounded-lg bg-accent text-foreground/80">
              <Icon size={15} strokeWidth={1.8} />
            </span>
            <span className="text-[14px] font-medium text-foreground/90">{row.label}</span>
          </button>
        );
      })}
      {/* Departments are only reachable upstream via right-click -> Move to -> New
          section, which is undiscoverable on desktop and impossible on a phone (no
          right-click, and the bot row carries no menu button). This is a visible,
          tappable entry point so a Zervi user can actually organise their assistants. */}
      {onCreateDepartment ? (
        <button
          type="button"
          data-testid="work-nav-new-department"
          onClick={onCreateDepartment}
          className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-sidebar-accent"
        >
          <span className="grid h-[30px] w-[30px] place-items-center rounded-lg bg-accent text-foreground/80">
            <FolderPlus size={15} strokeWidth={1.8} />
          </span>
          <span className="text-[14px] font-medium text-muted-foreground">
            <Trans>New department</Trans>
          </span>
        </button>
      ) : null}
    </nav>
  );
}

/**
 * Phone tab bar.
 *
 * WHY: on a 390px screen the sidebar is closed at rest, so the "Work" block above is
 * only reachable after opening the hamburger — the same discoverability defect this
 * whole change exists to fix, one level down. A shop-floor supervisor checking stock
 * on a phone should not have to know to swipe.
 *
 * Only shown below `md`, where the sidebar can be hidden. Chat is included as the
 * first tab so the bar does not strand the user away from the primary surface.
 */
export function EmployeeTabBar({
  boardEnabled,
  activePath,
  onNavigate,
  onOpenUsage,
  onOpenChat,
}: {
  boardEnabled: boolean;
  /** Current router path, used to mark the active tab. */
  activePath: string;
  onNavigate: (path: string) => void;
  onOpenUsage: () => void;
  onOpenChat: () => void;
}) {
  const { t } = useLingui();
  const tabs = [
    {
      testId: "tab-chat",
      label: <Trans>Chat</Trans>,
      icon: MessageSquare,
      path: null as string | null,
      onClick: onOpenChat,
      hidden: false,
    },
    {
      testId: "tab-documents",
      label: <Trans>Documents</Trans>,
      icon: FolderOpen,
      path: "/app/artifacts",
      onClick: () => onNavigate("/app/artifacts"),
      hidden: false,
    },
    {
      testId: "tab-routines",
      // "Tasks", not "Scheduled tasks": at 390px a five-tab bar gives each tab ~78px, and
      // the longer label truncates. The page heading carries the full name.
      label: <Trans>Tasks</Trans>,
      icon: CalendarClock,
      path: "/app/routines",
      onClick: () => onNavigate("/app/routines"),
      hidden: false,
    },
    {
      testId: "tab-board",
      label: <Trans>Board</Trans>,
      icon: SquareKanban,
      path: "/app/board",
      onClick: () => onNavigate("/app/board"),
      hidden: !boardEnabled,
    },
    {
      testId: "tab-usage",
      label: <Trans>Usage</Trans>,
      icon: Gauge,
      path: null as string | null,
      onClick: onOpenUsage,
      hidden: false,
    },
  ].filter((tab) => !tab.hidden);

  return (
    <nav
      data-testid="employee-tab-bar"
      aria-label={t`Work tabs`}
      className="flex shrink-0 items-stretch justify-around border-t border-sidebar-border bg-sidebar pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = tab.path !== null && activePath === tab.path;
        return (
          <button
            key={tab.testId}
            type="button"
            data-testid={tab.testId}
            aria-current={active ? "page" : undefined}
            onClick={tab.onClick}
            className={`flex flex-1 flex-col items-center gap-0.5 px-2 py-2 text-[11px] ${
              active ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            <Icon size={19} strokeWidth={1.8} />
            <span className="truncate">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
