const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Whole days remaining until `trialEndsAt`, floored at 0 (never negative).
 * `null` when there's no trial end date at all.
 *
 * Deliberately not inlined into the dashboard page component — the
 * `Date.now()` call here is impure, and eslint's react-hooks/purity rule
 * flags impure calls made directly inside a component's render body (this
 * is a Server Component, so the impurity is harmless — it runs once per
 * request, not on a client re-render — but the lint rule can't tell the
 * difference and treats every component body the same way).
 */
export function daysUntilTrialEnd(trialEndsAt: Date | null): number | null {
  if (!trialEndsAt) {
    return null;
  }

  return Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / MS_PER_DAY));
}
