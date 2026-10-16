import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";

export function formatRelativeTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 45) return t`just now`;
  const minutes = Math.floor(seconds / 60);
  // Below a minute, `minutes` is 0 and the next branch would print "0m ago" — measured on the
  // live Documents page, where a 45-59s old document read "0 นาทีที่แล้ว". The "just now" cutoff
  // and the minutes cutoff disagree, so anything in between must resolve to "just now" rather
  // than a zero unit.
  if (minutes < 1) return t`just now`;
  if (minutes < 60) return t`${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t`${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return t`${days}d ago`;
  return date.toLocaleDateString(i18n.locale || "en", { month: "short", day: "numeric" });
}

/**
 * A timestamp in the FUTURE: "in 8h", "in 3d".
 *
 * WHY THIS IS SEPARATE FROM `formatRelativeTime`: that function measures how long AGO
 * something happened. Given a future timestamp the duration is negative, so it falls into
 * the `seconds < 45` branch and returns "just now" — measured on the Scheduled-tasks page,
 * which read "Next run just now" for a run 8 hours away. Every other caller passes a past
 * timestamp (createdAt / updatedAt), so the shared function is left alone rather than
 * changed under Artifacts, Board and Activity.
 */
export function formatTimeUntil(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.floor((date.getTime() - now.getTime()) / 1000);
  if (seconds <= 0) return t`any moment now`;
  if (seconds < 60) return t`in under a minute`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t`in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t`in ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return t`in ${days}d`;
  return date.toLocaleDateString(i18n.locale || "en", { month: "short", day: "numeric" });
}
