import { getQStashReceiver } from "./qstash"
import type { createLogger } from "./logger"

type Logger = ReturnType<typeof createLogger>

export type QStashVerificationResult =
  | { ok: true; body: string }
  | { ok: false; response: Response }

/**
 * Verifies the incoming request is signed by QStash.
 * Returns the raw body on success, or a 401 Response on failure.
 */
export async function verifyQStashRequest(
  request: Request,
  log: Logger,
  context: Record<string, unknown> = {},
): Promise<QStashVerificationResult> {
  const signature = request.headers.get("upstash-signature")
  if (!signature) {
    log.warn("Missing upstash-signature header — rejecting request", context)
    return { ok: false, response: new Response("Unauthorized", { status: 401 }) }
  }

  const body = await request.text()

  try {
    const receiver = getQStashReceiver()
    const isValid = await receiver.verify({ signature, body, url: request.url })

    if (!isValid) {
      log.warn("Invalid QStash signature — rejecting request", context)
      return { ok: false, response: new Response("Unauthorized", { status: 401 }) }
    }
  } catch (err) {
    log.error("Signature verification failed", { ...context, error: String(err) })
    return { ok: false, response: new Response("Unauthorized", { status: 401 }) }
  }

  return { ok: true, body }
}
