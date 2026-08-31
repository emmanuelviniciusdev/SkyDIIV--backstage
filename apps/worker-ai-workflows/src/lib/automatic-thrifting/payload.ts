import { z } from "zod"

export const WardrobePanoramaIdPayloadSchema = z.object({
  wardrobePanoramaId: z.string().trim().min(1),
})

export type WardrobePanoramaIdPayload = z.infer<typeof WardrobePanoramaIdPayloadSchema>

export function parseWardrobePanoramaIdPayload(payload: unknown): string {
  const parsed = WardrobePanoramaIdPayloadSchema.safeParse(payload)
  if (!parsed.success) {
    throw new Error("Workflow payload must include a non-empty wardrobePanoramaId")
  }
  return parsed.data.wardrobePanoramaId
}
