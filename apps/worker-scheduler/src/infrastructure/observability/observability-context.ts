import { AsyncLocalStorage } from "node:async_hooks"
import type { ObservabilityPort } from "../../domain/ports/observability.port"

const storage = new AsyncLocalStorage<ObservabilityPort>()

export function runWithObservability<T>(observability: ObservabilityPort, fn: () => T): T {
  return storage.run(observability, fn)
}

export function getRequestObservability(): ObservabilityPort | undefined {
  return storage.getStore()
}
