import type { Logger } from "../../domain/ports/logger.port.js"
import type {
  ComputeProviderId,
  SelfDeletePort,
} from "../../domain/ports/self-delete.port.js"
import { NoopSelfDeleteProvider } from "./providers/noop.self-delete.provider.js"
import {
  OciSelfDeleteProvider,
  type OciSelfDeleteProviderConfig,
} from "./providers/oci.self-delete.provider.js"

export interface SelfDeleteProviderFactoryInput {
  /** Explicit provider id (`noop` | `oci`). Defaults to auto-detect. */
  provider?: string
  logger: Logger
  /** Present when provider is `oci`. */
  oci?: Partial<OciSelfDeleteProviderConfig> | null
}

/**
 * Provider factory for {@link SelfDeletePort}.
 *
 * Add a new cloud by:
 * 1. Implementing `SelfDeletePort` under `providers/`
 * 2. Registering the id in {@link ComputeProviderId}
 * 3. Handling it here
 */
export function createSelfDeleteProvider(
  input: SelfDeleteProviderFactoryInput,
): SelfDeletePort {
  const provider = resolveProviderId(input)

  input.logger.info("Selecting compute self-delete provider", { provider })

  switch (provider) {
    case "oci":
      return createOciProvider(input)
    case "noop":
      return new NoopSelfDeleteProvider(input.logger)
  }
}

function resolveProviderId(input: SelfDeleteProviderFactoryInput): ComputeProviderId {
  const explicit = (input.provider ?? "").trim().toLowerCase()
  if (explicit === "noop" || explicit === "oci") {
    return explicit
  }
  if (explicit) {
    throw new Error(`Unknown COMPUTE_PROVIDER "${explicit}" (expected noop|oci)`)
  }

  // Auto-detect: OCI when credentials + target are present.
  if (canUseOci(input.oci)) {
    return "oci"
  }
  return "noop"
}

function canUseOci(oci: SelfDeleteProviderFactoryInput["oci"]): boolean {
  if (!oci) return false
  const hasCredentials =
    Boolean(oci.region) &&
    Boolean(oci.tenancyOcid) &&
    Boolean(oci.userOcid) &&
    Boolean(oci.fingerprint) &&
    Boolean(oci.privateKey)
  const canResolveTarget =
    Boolean(oci.containerInstanceId) ||
    (Boolean(oci.compartmentId) && Boolean(oci.displayName))
  return hasCredentials && canResolveTarget
}

function createOciProvider(input: SelfDeleteProviderFactoryInput): SelfDeletePort {
  if (!canUseOci(input.oci)) {
    input.logger.warn(
      "COMPUTE_PROVIDER=oci but OCI credentials/target incomplete — falling back to noop",
    )
    return new NoopSelfDeleteProvider(input.logger)
  }

  const oci = input.oci!
  return new OciSelfDeleteProvider(
    {
      containerInstanceId: oci.containerInstanceId,
      compartmentId: oci.compartmentId,
      displayName: oci.displayName,
      region: oci.region!,
      tenancyOcid: oci.tenancyOcid!,
      userOcid: oci.userOcid!,
      fingerprint: oci.fingerprint!,
      privateKey: oci.privateKey!,
      waitForActiveMs: oci.waitForActiveMs,
      pollIntervalMs: oci.pollIntervalMs,
      activeGraceMs: oci.activeGraceMs,
    },
    input.logger,
  )
}
