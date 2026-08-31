import { createSign } from "node:crypto"
import { readFile } from "node:fs/promises"
import type { Logger } from "../../../domain/ports/logger.port.js"
import type { SelfDeletePort } from "../../../domain/ports/self-delete.port.js"

export interface OciSelfDeleteProviderConfig {
  /** When set, deletes this OCID directly. */
  containerInstanceId?: string
  /** Used with displayName to resolve the OCID when id is unknown at boot. */
  compartmentId?: string
  displayName?: string
  region: string
  tenancyOcid: string
  userOcid: string
  fingerprint: string
  /** PEM contents or path to the API private key. */
  privateKey: string
  /**
   * How long to wait for this instance to reach ACTIVE before giving up.
   *
   * A drain over an empty queue finishes in about a second, well before OCI has
   * promoted the instance out of CREATING. Deleting is only possible from
   * ACTIVE, and `terraform apply` is still waiting for that same transition, so
   * the robot has to outlive it rather than exit immediately.
   */
  waitForActiveMs?: number
  /** Poll interval while waiting for ACTIVE. */
  pollIntervalMs?: number
  /**
   * Extra delay once ACTIVE, so `terraform apply` observes ACTIVE before the
   * delete moves the instance to DELETING.
   *
   * Terraform's create-wait polls on the order of a minute, so a short window
   * gets missed. Idle A1 time is worth far less than a failed weekly run, and
   * `deploy/tf-apply.sh` covers the case where the poll is missed anyway.
   */
  activeGraceMs?: number
}

const DEFAULT_WAIT_FOR_ACTIVE_MS = 240_000
const DEFAULT_POLL_INTERVAL_MS = 5_000
const DEFAULT_ACTIVE_GRACE_MS = 120_000

/** Minimal fetch signature used by the adapter (injectable for tests). */
export type FetchLike = (
  input: string,
  init?: {
    method?: string
    headers?: Record<string, string>
  },
) => Promise<{
  ok: boolean
  status: number
  text: () => Promise<string>
  json: () => Promise<unknown>
}>

/**
 * OCI compute provider — deletes this Container Instance via signed REST API.
 *
 * One of several {@link SelfDeletePort} providers. Selected when
 * `COMPUTE_PROVIDER=oci`.
 */
export class OciSelfDeleteProvider implements SelfDeletePort {
  constructor(
    private readonly config: OciSelfDeleteProviderConfig,
    private readonly logger: Logger,
    private readonly fetchFn: FetchLike = fetch,
    private readonly sleepFn: (ms: number) => Promise<void> = defaultSleep,
  ) {}

  async deleteSelf(): Promise<void> {
    const containerInstanceId = await this.resolveContainerInstanceId()
    this.logger.info("Self-deleting compute (OCI Container Instance)", {
      provider: "oci",
      containerInstanceId,
      region: this.config.region,
    })

    const response = await this.signedRequest(
      "DELETE",
      `/20210415/containerInstances/${encodeURIComponent(containerInstanceId)}`,
    )

    if (response.status === 404) {
      this.logger.warn("Container Instance already gone (404) — treating as success", {
        containerInstanceId,
      })
      return
    }

    if (!response.ok && response.status !== 204) {
      const body = await response.text().catch(() => "")
      throw new Error(
        `OCI Container Instance delete failed (${response.status}): ${body}`,
      )
    }

    this.logger.info("OCI Container Instance delete accepted", {
      containerInstanceId,
      status: response.status,
    })
  }

  private async resolveContainerInstanceId(): Promise<string> {
    if (this.config.containerInstanceId) {
      return this.config.containerInstanceId
    }

    const compartmentId = this.config.compartmentId
    const displayName = this.config.displayName
    if (!compartmentId || !displayName) {
      throw new Error(
        "OCI self-delete needs OCI_CONTAINER_INSTANCE_OCID, or OCI_COMPARTMENT_OCID + ROBOT_DISPLAY_NAME",
      )
    }

    const waitForActiveMs = this.config.waitForActiveMs ?? DEFAULT_WAIT_FOR_ACTIVE_MS
    const pollIntervalMs = this.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    const graceMs = this.config.activeGraceMs ?? DEFAULT_ACTIVE_GRACE_MS
    const deadline = Date.now() + waitForActiveMs

    for (;;) {
      const instance = await this.findInstance(compartmentId, displayName)
      const state = instance?.lifecycleState ?? "absent"

      if (instance?.id && instance.lifecycleState === "ACTIVE") {
        if (graceMs > 0) {
          this.logger.info("Container Instance ACTIVE — waiting before self-delete", {
            containerInstanceId: instance.id,
            graceMs,
          })
          await this.sleepFn(graceMs)
        }
        return instance.id
      }

      if (Date.now() + pollIntervalMs > deadline) {
        throw new Error(
          `Container Instance "${displayName}" never reached ACTIVE within ${waitForActiveMs}ms ` +
            `(last state: ${state})`,
        )
      }

      this.logger.debug("Waiting for Container Instance to become ACTIVE", {
        displayName,
        state,
      })
      await this.sleepFn(pollIntervalMs)
    }
  }

  /**
   * Newest non-terminal instance with this display name. Terminal ones are
   * ignored because every previous weekly run leaves an INACTIVE namesake
   * behind.
   */
  private async findInstance(
    compartmentId: string,
    displayName: string,
  ): Promise<{ id?: string; lifecycleState?: string } | null> {
    const query =
      `compartmentId=${encodeURIComponent(compartmentId)}` +
      `&displayName=${encodeURIComponent(displayName)}` +
      `&sortBy=timeCreated&sortOrder=DESC` +
      `&limit=25`

    const response = await this.signedRequest(
      "GET",
      `/20210415/containerInstances?${query}`,
    )

    if (!response.ok) {
      const body = await response.text().catch(() => "")
      throw new Error(
        `OCI list container instances failed (${response.status}): ${body}`,
      )
    }

    const json = (await response.json()) as {
      items?: Array<{ id?: string; displayName?: string; lifecycleState?: string }>
    }

    const candidates = (json.items ?? []).filter(
      (item) =>
        item.displayName === displayName &&
        item.lifecycleState !== "DELETED" &&
        item.lifecycleState !== "DELETING" &&
        item.lifecycleState !== "INACTIVE" &&
        item.lifecycleState !== "FAILED",
    )

    return candidates[0] ?? null
  }

  private async signedRequest(
    method: string,
    pathAndQuery: string,
  ): Promise<{
    ok: boolean
    status: number
    text: () => Promise<string>
    json: () => Promise<unknown>
  }> {
    const host = `compute-containers.${this.config.region}.oci.oraclecloud.com`
    const path = pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`
    const date = new Date().toUTCString()
    const privateKeyPem = await resolvePrivateKey(this.config.privateKey)
    const keyId = `${this.config.tenancyOcid}/${this.config.userOcid}/${this.config.fingerprint}`

    const requestTargetPath = path.split("?")[0] ?? path
    const signingString = [
      `(request-target): ${method.toLowerCase()} ${requestTargetPath}${path.includes("?") ? `?${path.split("?")[1]}` : ""}`,
      `host: ${host}`,
      `date: ${date}`,
    ].join("\n")

    const signer = createSign("RSA-SHA256")
    signer.update(signingString)
    const signature = signer.sign(privateKeyPem, "base64")

    const authorization =
      `Signature version="1",keyId="${keyId}",algorithm="rsa-sha256",` +
      `headers="(request-target) host date",signature="${signature}"`

    return this.fetchFn(`https://${host}${path}`, {
      method,
      headers: {
        Host: host,
        Date: date,
        Authorization: authorization,
      },
    })
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function resolvePrivateKey(value: string): Promise<string> {
  const trimmed = value.trim()
  if (trimmed.includes("BEGIN") && trimmed.includes("PRIVATE KEY")) {
    return trimmed
  }
  return (await readFile(trimmed, "utf8")).trim()
}
