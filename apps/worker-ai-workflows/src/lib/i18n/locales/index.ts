import { DEFAULT_LOCALE, type Locale } from "../config"
import type { LocaleMessages } from "../types"
import { enUS } from "./en-US"
import { esPE } from "./es-PE"
import { ptBR } from "./pt-BR"

const LOCALE_MESSAGES: Record<Locale, LocaleMessages> = {
  "pt-BR": ptBR,
  "es-PE": esPE,
  "en-US": enUS,
}

export function getLocaleMessages(locale: Locale): LocaleMessages {
  return LOCALE_MESSAGES[locale] ?? LOCALE_MESSAGES[DEFAULT_LOCALE]
}
