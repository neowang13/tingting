export const ADMIN_IDLE_TIMEOUT_MS = 60 * 60_000;
export const ADMIN_ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60_000;
export const ADMIN_LAST_ACTIVE_COOKIE = "tt-last-active";
export const ADMIN_SESSION_STARTED_COOKIE = "tt-session-started";

export function adminSessionTimes(lastActive: string | undefined, started: string | undefined, now = Date.now()) {
  const lastActiveAt = Number(lastActive);
  const startedAt = Number(started);
  const valid = Number.isFinite(lastActiveAt) && lastActiveAt > 0 && Number.isFinite(startedAt) && startedAt > 0
    && lastActiveAt <= now + 60_000 && startedAt <= now + 60_000;
  return { lastActiveAt, startedAt, idleExpiresAt: lastActiveAt + ADMIN_IDLE_TIMEOUT_MS,
    absoluteExpiresAt: startedAt + ADMIN_ABSOLUTE_TIMEOUT_MS,
    expired: !valid || now >= lastActiveAt + ADMIN_IDLE_TIMEOUT_MS || now >= startedAt + ADMIN_ABSOLUTE_TIMEOUT_MS };
}
