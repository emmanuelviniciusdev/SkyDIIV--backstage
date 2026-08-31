import type { Logger } from "../../../domain/ports/logger.port.js"
import type { SelfDeletePort } from "../../../domain/ports/self-delete.port.js"

/**
 * Local / test self-delete — logs and returns without calling any cloud API.
 */
export class NoopSelfDeleteProvider implements SelfDeletePort {
  constructor(private readonly logger: Logger) {}

  deleteSelf(): Promise<void> {
    this.logger.info("Self-delete skipped (noop compute provider)")
    return Promise.resolve()
  }
}
