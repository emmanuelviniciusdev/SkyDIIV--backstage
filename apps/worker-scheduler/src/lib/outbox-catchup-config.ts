/** Default minimum age before a PENDING outbox event is eligible for catch-up. */
export const DEFAULT_OUTBOX_CATCHUP_MIN_AGE_MINUTES = 10

/**
 * Returns how many minutes a PENDING outbox event must exist before the
 * catch-up flow re-enqueues it. Configured via OUTBOX_CATCHUP_MIN_AGE_MINUTES
 * (defaults to 10). Invalid values fall back to the default.
 */
export function getOutboxCatchupMinAgeMinutes(): number {
  const raw = process.env.OUTBOX_CATCHUP_MIN_AGE_MINUTES?.trim()
  if (!raw) return DEFAULT_OUTBOX_CATCHUP_MIN_AGE_MINUTES

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_OUTBOX_CATCHUP_MIN_AGE_MINUTES
  }

  return parsed
}
