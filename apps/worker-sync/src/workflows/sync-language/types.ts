import { z } from "zod"
import type { TranslatableWeeklyOutfit } from "../../lib/db/weekly-outfits.repository"
import type { TranslatableWardrobePanorama } from "../../lib/db/wardrobe-panorama.repository"

export const syncLanguagePayloadSchema = z.object({
  userid: z.string().min(1),
  old_language: z.string().min(1),
  new_language: z.string().min(1),
})

export type SyncLanguagePayload = z.infer<typeof syncLanguagePayloadSchema>

export interface TranslatableRecords {
  weeklyOutfits: TranslatableWeeklyOutfit[]
  wardrobePanorama: TranslatableWardrobePanorama | null
}

export interface SyncLanguageResult {
  userid: string
  old_language: string
  new_language: string
  weeklyOutfitsLoaded: number
  weeklyOutfitsTranslated: number
  wardrobePanoramaTranslated: boolean
}
