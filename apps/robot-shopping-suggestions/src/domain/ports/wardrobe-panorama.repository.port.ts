/**
 * Port for reading the user's wardrobe panorama.
 */
export interface WardrobePanoramaRepositoryPort {
  /** Returns the panorama id for the user, or null when none exists. */
  findIdByUserId(userId: string): Promise<string | null>
}
