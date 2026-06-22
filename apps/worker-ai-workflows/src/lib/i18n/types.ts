export interface LocaleMessages {
  weather: {
    locationLabel: string
    forecastHeader: string
    maxLabel: string
    minLabel: string
    rainLabel: string
    fallbackDescription: string
    weatherCodeDescription(code: number): string
  }
  fallbacks: {
    noWardrobe: string
    noPreferences: string
    noTitle: string
    noTags: string
    userNameUnknown: string
    locationUndefined: string
    routineUndefined: string
    preferencesUndefined: string
    noPieces: string
    noTitlePanorama: string
    noTagsPanorama: string
  }
  weeklyOutfits: {
    wardrobeLine(id: string, title: string, tags: string): string
  }
  wardrobePanorama: {
    wardrobeLine(id: string, title: string, tags: string): string
    preferencesSection(location: string, routine: string): string
  }
}
