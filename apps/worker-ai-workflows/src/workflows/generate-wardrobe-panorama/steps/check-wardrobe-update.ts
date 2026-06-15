import { hasWardrobeUpdateCheck } from "../../../lib/cache/wardrobe-panorama-cache"
import { createLogger } from "../../../lib/logger"

/**
 * Returns true when the wardrobe-update-check Redis marker exists for the user.
 * The panorama workflow should only run in that case.
 */
export async function checkWardrobeUpdateStep(userId: string): Promise<boolean> {
  const log = createLogger("check-wardrobe-update", userId)
  log.info("Step started")

  const shouldRun = await hasWardrobeUpdateCheck(userId)
  log.info("Step completed", { shouldRun })

  return shouldRun
}
