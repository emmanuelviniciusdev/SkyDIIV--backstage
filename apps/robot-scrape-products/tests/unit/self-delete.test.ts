import { describe, expect, it, vi } from "vitest"
import { createSelfDeleteProvider } from "../../src/infrastructure/compute/self-delete.provider.factory.js"
import { NoopSelfDeleteProvider } from "../../src/infrastructure/compute/providers/noop.self-delete.provider.js"
import { OciSelfDeleteProvider } from "../../src/infrastructure/compute/providers/oci.self-delete.provider.js"
import type { Logger } from "../../src/domain/ports/logger.port.js"
import { generateKeyPairSync } from "node:crypto"

function silentLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

const testPem = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey

const ociCreds = {
  containerInstanceId: "ocid1.computecontainerinstance.oc1..abc",
  region: "us-ashburn-1",
  tenancyOcid: "ocid1.tenancy.oc1..t",
  userOcid: "ocid1.user.oc1..u",
  fingerprint: "aa:bb:cc",
  privateKey: testPem,
}

describe("createSelfDeleteProvider (provider pattern)", () => {
  it("returns noop when provider is noop", async () => {
    const provider = createSelfDeleteProvider({
      provider: "noop",
      logger: silentLogger(),
      oci: ociCreds,
    })
    expect(provider).toBeInstanceOf(NoopSelfDeleteProvider)
    await expect(provider.deleteSelf()).resolves.toBeUndefined()
  })

  it("auto-detects noop when OCI credentials are missing", () => {
    const provider = createSelfDeleteProvider({
      logger: silentLogger(),
    })
    expect(provider).toBeInstanceOf(NoopSelfDeleteProvider)
  })

  it("auto-detects oci when credentials + target are present", () => {
    const provider = createSelfDeleteProvider({
      logger: silentLogger(),
      oci: ociCreds,
    })
    expect(provider).toBeInstanceOf(OciSelfDeleteProvider)
  })

  it("selects oci explicitly via COMPUTE_PROVIDER", () => {
    const provider = createSelfDeleteProvider({
      provider: "oci",
      logger: silentLogger(),
      oci: ociCreds,
    })
    expect(provider).toBeInstanceOf(OciSelfDeleteProvider)
  })

  it("falls back to noop when COMPUTE_PROVIDER=oci but credentials incomplete", () => {
    const warn = vi.fn()
    const logger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn,
      error: vi.fn(),
    }
    const provider = createSelfDeleteProvider({
      provider: "oci",
      logger,
      oci: { region: "us-ashburn-1" },
    })
    expect(provider).toBeInstanceOf(NoopSelfDeleteProvider)
    expect(warn).toHaveBeenCalled()
  })

  it("rejects unknown providers", () => {
    expect(() =>
      createSelfDeleteProvider({
        provider: "aws",
        logger: silentLogger(),
      }),
    ).toThrow(/Unknown COMPUTE_PROVIDER/)
  })
})

describe("OciSelfDeleteProvider", () => {
  it("DELETEs the configured Container Instance OCID", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      text: async () => "",
      json: async () => ({}),
    })

    const del = new OciSelfDeleteProvider(ociCreds, silentLogger(), fetchFn)

    await del.deleteSelf()

    expect(fetchFn).toHaveBeenCalledOnce()
    const [url, init] = fetchFn.mock.calls[0] as [string, { method?: string; headers?: Record<string, string> }]
    expect(url).toContain("compute-containers.us-ashburn-1.oci.oraclecloud.com")
    expect(url).toContain("ocid1.computecontainerinstance.oc1..abc")
    expect(init.method).toBe("DELETE")
    expect(String(init.headers?.Authorization)).toContain("Signature")
  })

  it("waits for the instance to leave CREATING before deleting", async () => {
    const states = ["CREATING", "CREATING", "ACTIVE"]
    const fetchFn = vi.fn().mockImplementation((url: string) => {
      if (url.includes("?compartmentId=")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({
            items: [
              {
                id: "ocid1.computecontainerinstance.oc1..resolved",
                displayName: "robot",
                lifecycleState: states.shift() ?? "ACTIVE",
              },
            ],
          }),
        })
      }
      return Promise.resolve({
        ok: true,
        status: 204,
        text: async () => "",
        json: async () => ({}),
      })
    })
    const sleeps: number[] = []

    const del = new OciSelfDeleteProvider(
      {
        ...ociCreds,
        containerInstanceId: undefined,
        compartmentId: "ocid1.compartment.oc1..c",
        displayName: "robot",
        pollIntervalMs: 10,
        activeGraceMs: 7,
      },
      silentLogger(),
      fetchFn,
      async (ms) => {
        sleeps.push(ms)
      },
    )

    await del.deleteSelf()

    expect(sleeps).toEqual([10, 10, 7])
    const deleteCall = fetchFn.mock.calls.find(
      ([, init]) => (init as { method?: string } | undefined)?.method === "DELETE",
    ) as [string, { method?: string }] | undefined
    expect(deleteCall?.[0]).toContain("ocid1.computecontainerinstance.oc1..resolved")
  })

  it("ignores namesakes left INACTIVE by previous runs", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({
        items: [
          { id: "ocid1..old", displayName: "robot", lifecycleState: "INACTIVE" },
          { id: "ocid1..older", displayName: "robot", lifecycleState: "DELETED" },
        ],
      }),
    })

    const del = new OciSelfDeleteProvider(
      {
        ...ociCreds,
        containerInstanceId: undefined,
        compartmentId: "ocid1.compartment.oc1..c",
        displayName: "robot",
        waitForActiveMs: 20,
        pollIntervalMs: 10,
      },
      silentLogger(),
      fetchFn,
      async () => {},
    )

    await expect(del.deleteSelf()).rejects.toThrow(/never reached ACTIVE/)
    expect(
      fetchFn.mock.calls.some(
        ([, init]) => (init as { method?: string } | undefined)?.method === "DELETE",
      ),
    ).toBe(false)
  })

  it("treats 404 as success", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "not found",
      json: async () => ({}),
    })

    const del = new OciSelfDeleteProvider(ociCreds, silentLogger(), fetchFn)
    await expect(del.deleteSelf()).resolves.toBeUndefined()
  })
})
