/**
 * Core abstractions for the central scheduler.
 *
 * The worker exposes one endpoint per weekday (/schedule/every-monday … sunday),
 * a daily endpoint (/schedule/everyday), and dedicated endpoints for individual
 * flows (e.g. /schedule/catch-up-outbox-events).
 * Each weekday endpoint can have multiple `ScheduleFlow`s registered. Once the QStash
 * signature is verified, all flows for that day run in parallel. Results are collected
 * individually — one flow failing never stops the others.
 *
 * New weekday jobs are added by implementing a flow and registering it in
 * `flows/registry.ts` — no routing changes needed.
 */

export type Weekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday"

export const WEEKDAYS: readonly Weekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]

/**
 * Result returned by a successful flow run. `flow` identifies which flow
 * produced it; any additional fields (e.g. `dispatched`) are flow-specific
 * and surfaced verbatim in the HTTP response for observability.
 */
export interface FlowResult {
  flow: string
  [key: string]: unknown
}

/**
 * Per-flow outcome as reported in the endpoint response.
 * Successful runs carry `status: "ok"` plus the flow's own result fields.
 * Failed runs carry `status: "error"` and the error message.
 */
export type FlowRunResult =
  | ({ status: "ok" } & FlowResult)
  | { flow: string; status: "error"; error: string }

/** A unit of scheduled work triggered by a weekday endpoint. */
export interface ScheduleFlow {
  /** Stable identifier used in logs and responses. */
  name: string
  /** Executes the flow. Throws on failure — the handler captures it. */
  run(): Promise<FlowResult>
}
