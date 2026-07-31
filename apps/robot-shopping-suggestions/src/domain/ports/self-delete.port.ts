/**
 * Deletes this robot's own compute so idle infra stops billing.
 *
 * Implementations are cloud-provider specific and selected via
 * {@link createSelfDeleteProvider} (provider pattern). Local / tests use noop.
 */
export interface SelfDeletePort {
  /**
   * Permanently deletes the running compute resource for this robot.
   * Safe to call when not configured — implementations may no-op.
   */
  deleteSelf(): Promise<void>
}

/** Supported compute providers for self-delete. Extend when adding clouds. */
export type ComputeProviderId = "noop" | "oci"
