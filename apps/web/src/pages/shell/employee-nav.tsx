import { Trans } from "@lingui/react/macro";
import { FolderOpen, Gauge, SquareKanban } from "lucide-react";

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
}: {
  boardEnabled: boolean;
  /** Chosen destination path; the caller navigates and closes the mobile sidebar. */
  onNavigate: (path: string) => void;
  /** Usage is a settings-overlay section, not a route. */
  onOpenUsage: () => void;
}) {
  const rows = [
    {
      testId: "work-nav-artifacts",
      label: <Trans>Documents</Trans>,
      icon: FolderOpen,
      onClick: () => onNavigate("/app/artifacts"),
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
    <nav data-testid="work-nav" aria-label="Work" className="mx-3 mb-1">
      <div className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground/70">
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
    </nav>
  );
}
