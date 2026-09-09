import type { ObservabilityPort } from "../../domain/ports/observability.port"
import { GrafanaCloudOtlpProvider } from "./providers/grafana-cloud.otlp.provider"
import { NoopObservabilityProvider } from "./providers/noop.provider"

export type ObservabilityProviderId = "grafana-cloud" | "noop"

export interface ObservabilityProviderFactoryInput {
  provider?: string
  serviceName: string
  deploymentEnvironment?: string
  otlp?: {
    endpoint?: string
    headers?: string
  }
}

/**
 * Provider factory for {@link ObservabilityPort}.
 *
 * Add a new backend by:
 * 1. Implementing `ObservabilityPort` under `providers/`
 * 2. Registering the id in {@link ObservabilityProviderId}
 * 3. Handling it here
 */
export function createObservabilityProvider(
  input: ObservabilityProviderFactoryInput,
): ObservabilityPort {
  const provider = resolveProviderId(input)
  const deploymentEnvironment = input.deploymentEnvironment?.trim() || "local"

  switch (provider) {
    case "grafana-cloud":
      return createGrafanaProvider(input, deploymentEnvironment)
    case "noop":
      return new NoopObservabilityProvider(input.serviceName)
  }
}

function resolveProviderId(input: ObservabilityProviderFactoryInput): ObservabilityProviderId {
  const explicit = (input.provider ?? "").trim().toLowerCase()
  if (explicit === "noop" || explicit === "grafana-cloud") {
    return explicit
  }
  if (explicit) {
    throw new Error(
      `Unknown OBSERVABILITY_PROVIDER "${explicit}" (expected grafana-cloud|noop)`,
    )
  }
  return canUseGrafanaCloud(input.otlp) ? "grafana-cloud" : "noop"
}

function canUseGrafanaCloud(otlp: ObservabilityProviderFactoryInput["otlp"]): boolean {
  return Boolean(otlp?.endpoint?.trim()) && Boolean(otlp?.headers?.trim())
}

function createGrafanaProvider(
  input: ObservabilityProviderFactoryInput,
  deploymentEnvironment: string,
): ObservabilityPort {
  const endpoint = input.otlp?.endpoint?.trim() ?? ""
  const headers = input.otlp?.headers?.trim() ?? ""
  if (!endpoint || !headers) {
    console.warn(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "WARN",
        app: input.serviceName,
        msg: "OBSERVABILITY_PROVIDER=grafana-cloud but OTLP endpoint/headers incomplete — falling back to noop",
      }),
    )
    return new NoopObservabilityProvider(input.serviceName)
  }

  return new GrafanaCloudOtlpProvider({
    serviceName: input.serviceName,
    deploymentEnvironment,
    endpoint,
    headers,
  })
}
