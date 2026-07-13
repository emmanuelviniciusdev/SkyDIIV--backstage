import type { Locale } from "../../../../../lib/i18n/config"
import { getWelcomeEmailCopy, WELCOME_EMAIL_SUBJECT, type WelcomeEmailCopy } from "./copy"
import { buildWordmarkHtml } from "./wordmark"

export interface WelcomeEmailInput {
  locale: Locale
  firstName?: string
  appUrl: string
}

export interface WelcomeEmailContent {
  subject: string
  html: string
  text: string
}

const C = {
  background: "#F4F4F2",
  foreground: "#B5BAC2",
  muted: "#C2BCA8",
  primary: "#6C92AB",
  primaryFg: "#F4F4F2",
} as const

const FONT_CSS = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function buildPlainText(copy: WelcomeEmailCopy, ctaUrl: string): string {
  return [
    WELCOME_EMAIL_SUBJECT,
    "",
    copy.greeting,
    "",
    copy.welcome,
    "",
    copy.bodyLine1,
    copy.bodyLine2,
    copy.bodyLine3,
    "",
    `${copy.cta}: ${ctaUrl}`,
    "",
    copy.signoff,
  ].join("\n")
}

function buildHeaderHtml(): string {
  const wordmark = buildWordmarkHtml(FONT_CSS)
  return `<p style="margin:0 0 36px 0;">${wordmark}</p>`
}

function buildHtml(copy: WelcomeEmailCopy, ctaUrl: string, locale: Locale): string {
  const title = escapeHtml(WELCOME_EMAIL_SUBJECT)
  const header = buildHeaderHtml()

  return `<!DOCTYPE html>
<html lang="${locale}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light" />
    <title>${title}</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400&amp;display=swap" rel="stylesheet" />
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400&display=swap');
    </style>
  </head>
  <body style="margin:0;padding:0;background-color:${C.background};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.background};">
      <tr>
        <td align="center" style="padding:56px 24px;">
          <table role="presentation" width="440" cellpadding="0" cellspacing="0" border="0" style="width:440px;max-width:100%;">
            <tr>
              <td style="font-family:${FONT_CSS};font-size:16px;font-weight:300;line-height:1.75;color:${C.foreground};text-transform:lowercase;">
                ${header}
                <p style="margin:0 0 18px 0;">${escapeHtml(copy.greeting)}</p>
                <p style="margin:0 0 18px 0;">${escapeHtml(copy.welcome)}</p>
                <p style="margin:0 0 4px 0;">${escapeHtml(copy.bodyLine1)}</p>
                <p style="margin:0 0 4px 0;">${escapeHtml(copy.bodyLine2)}</p>
                <p style="margin:0 0 28px 0;">${escapeHtml(copy.bodyLine3)}</p>
                <p style="margin:0 0 32px 0;">
                  <a href="${ctaUrl}" target="_blank" style="display:inline-block;background-color:${C.primary};color:${C.primaryFg};font-family:${FONT_CSS};font-size:11px;font-weight:300;letter-spacing:0.18em;text-transform:lowercase;text-decoration:none;padding:12px 22px;border-radius:4px;">
                    ${escapeHtml(copy.cta)}
                  </a>
                </p>
                <p style="margin:0;color:${C.muted};">${escapeHtml(copy.signoff)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

/**
 * Builds the welcome email for the given user locale.
 * Subject is always English (`you're in — SkyDIIV`).
 */
export function renderWelcomeEmail(input: WelcomeEmailInput): WelcomeEmailContent {
  const appUrl = input.appUrl.replace(/\/+$/, "")
  const ctaUrl = `${appUrl}/home`
  const copy = getWelcomeEmailCopy(input.locale, input.firstName)

  return {
    subject: WELCOME_EMAIL_SUBJECT,
    html: buildHtml(copy, ctaUrl, input.locale),
    text: buildPlainText(copy, ctaUrl),
  }
}
