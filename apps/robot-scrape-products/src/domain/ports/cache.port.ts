/**
 * Port for SkyDIIV web-app Redis caches (separate from the stream broker Redis).
 * Keys must stay in sync with the skydiiv web app.
 */
export interface CachePort {
  /** DEL `shopping-suggestions:{userId}` on the web Redis */
  invalidateShoppingSuggestions(userId: string): Promise<void>

  /**
   * SET `notification:new-shopping-suggestions:{userId}`
   * with `{"updatedAt":"<ISO>"}` on the web Redis (Topbar indicator).
   */
  setNewShoppingSuggestionsNotification(userId: string): Promise<void>
}
