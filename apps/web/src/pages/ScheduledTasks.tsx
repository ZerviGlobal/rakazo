import { Trans, useLingui } from "@lingui/react/macro";
import type { Routine } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { CalendarClock, ChevronLeft, Pause, Play } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Link, useNavigate } from "react-router-dom";
import { formatTimeUntil } from "../lib/relative-time";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";
import { desktopBridge } from "../lib/desktop";
import {
  getTicketBoardEnabled,
  subscribeTicketBoardEnabled,
} from "../lib/bootstrap";
import { EmployeeTabBar, requestSettingsSection } from "./shell/employee-nav";
import { routineTriggerSummary } from "./RoutineEditor";
import { WindowChrome } from "./WindowChrome";

/**
 * Scheduled tasks — the employee-facing name for routines.
 *
 * WHY THIS PAGE EXISTS: routines had no route. They were listed inside a single bot's
 * context panel, and `rpc.routines.list` is per-bot, so there was no answer to the only
 * question an employee has — "what runs in my space, and when?" The sidebar row for this
 * was deliberately omitted earlier rather than linked to a route that would be swallowed
 * by `/app/:botId`; this page is the thing that was missing.
 *
 * Grouped by assistant, because "who does this" is how a supervisor looks for a job, and
 * the schedule is stated in words (via the same `routineTriggerSummary` the bot panel
 * uses) rather than as a raw cron expression.
 */
type SpaceRoutine = Routine & { botName: string };

function groupByBot(routines: SpaceRoutine[]) {
  const groups = new Map<string, SpaceRoutine[]>();
  for (const routine of routines) {
    const key = routine.botName;
    const list = groups.get(key);
    if (list) list.push(routine);
    else groups.set(key, [routine]);
  }
  return [...groups.entries()].map(([botName, items]) => ({ botName, items }));
}

export function ScheduledTasksPage() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const [routines, setRoutines] = useState<SpaceRoutine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const boardEnabled = useSyncExternalStore(
    subscribeTicketBoardEnabled,
    getTicketBoardEnabled,
  );

  const load = useMemo(
    () => async () => {
      try {
        const rows = await rpc.routines.listSpace({});
        setRoutines(rows);
        setError(null);
      } catch (cause) {
        setError(errorText(cause));
        setRoutines([]);
      }
    },
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleActive(routine: SpaceRoutine) {
    setBusyId(routine.id);
    try {
      await rpc.routines.update({ routineId: routine.id, active: !routine.active });
      await load();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusyId(null);
    }
  }

  const groups = groupByBot(routines ?? []);
  const activeCount = (routines ?? []).filter((routine) => routine.active).length;

  return (
    <div className="flex h-full min-w-0 flex-col bg-background text-foreground/90">
      <header className="app-drag border-b border-border px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex items-center gap-2">
            {desktopBridge() ? <WindowChrome /> : null}
            <Link
              to="/app"
              className="app-no-drag flex shrink-0 items-center gap-0.5 rounded-lg py-1 pe-1.5 text-[13px] font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <ChevronLeft size={16} strokeWidth={1.9} aria-hidden="true" />
              <Trans>Assistants</Trans>
            </Link>
            <h1 className="text-xl font-semibold">
              <Trans>Scheduled tasks</Trans>
            </h1>
          </div>
          {routines && routines.length > 0 ? (
            <p className="text-[13px] text-muted-foreground">
              <Trans>
                {activeCount} of {routines.length} running
              </Trans>
            </p>
          ) : null}
        </div>
      </header>

      <div className="rk-scroll min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
        {error ? (
          <p role="alert" className="mb-4 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {routines === null ? (
          <p className="text-sm text-muted-foreground">
            <Trans>Loading…</Trans>
          </p>
        ) : routines.length === 0 ? (
          <div className="grid place-items-center py-16 text-center">
            <div className="max-w-md space-y-2">
              <CalendarClock
                className="mx-auto text-muted-foreground"
                size={28}
                strokeWidth={1.6}
              />
              <p className="text-sm text-muted-foreground">
                <Trans>
                  Nothing is scheduled yet. Open an assistant and add a scheduled task to make
                  it run on its own.
                </Trans>
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.botName} data-testid={`scheduled-group-${group.botName}`}>
                <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {group.botName}
                </h2>
                <ul className="space-y-2">
                  {group.items.map((routine) => (
                    <li
                      key={routine.id}
                      data-testid={`scheduled-task-${routine.id}`}
                      className="flex items-start justify-between gap-3 rounded-xl border border-border px-3.5 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium">{routine.name}</p>
                        <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                          {routineTriggerSummary(routine)}
                        </p>
                        <p className="mt-0.5 text-[12.5px] text-muted-foreground/80">
                          {routine.active
                            ? routine.nextRunAt
                              ? t`Next run ${formatTimeUntil(routine.nextRunAt)}`
                              : t`Waiting for its first run`
                            : t`Paused`}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={routine.active ? t`Pause ${routine.name}` : t`Resume ${routine.name}`}
                        data-testid={`scheduled-toggle-${routine.id}`}
                        disabled={busyId === routine.id}
                        onClick={() => void toggleActive(routine)}
                      >
                        {routine.active ? (
                          <Pause size={15} strokeWidth={1.9} />
                        ) : (
                          <Play size={15} strokeWidth={1.9} />
                        )}
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      {/* Same reasoning as the Documents page: this route has no shell-root, so without the
          bar a phone user who taps Scheduled tasks loses all navigation. */}
      <EmployeeTabBar
        boardEnabled={boardEnabled}
        activePath="/app/routines"
        onNavigate={(path) => navigate(path)}
        onOpenUsage={() => {
          requestSettingsSection("usage");
          navigate("/app");
        }}
        onOpenChat={() => navigate("/app")}
      />
    </div>
  );
}
