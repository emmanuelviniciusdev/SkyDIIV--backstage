/**
 * Per-letter gradient stops for the skydiiv wordmark.
 * Keep in sync with skydiiv/web/lib/logo-colors.ts
 */
export const LOGO_LETTER_GRADIENTS = [
  { ch: "s", top: "#AC7C76", bottom: "#C69689" },
  { ch: "k", top: "#CAA07F", bottom: "#E4BC96" },
  { ch: "y", top: "#B1B1A4", bottom: "#D0C3A9" },
  { ch: "d", top: "#7496AD", bottom: "#9DB0BF" },
  { ch: "i", top: "#85A5BF", bottom: "#AAB7C8" },
  { ch: "i", top: "#B4BFD5", bottom: "#C5C0CD" },
  { ch: "v", top: "#A39BBF", bottom: "#BDADC4" },
] as const

export function buildWordmarkHtml(fontFamily: string): string {
  const letters = LOGO_LETTER_GRADIENTS.map(({ ch, top, bottom }) => {
    return `<span style="display:inline-block;color:${top};background:linear-gradient(180deg,${top} 0%,${bottom} 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;font-family:${fontFamily};font-weight:300;">${ch}</span>`
  }).join("")

  return `<span style="display:inline-block;font-family:${fontFamily};font-size:15px;font-weight:300;letter-spacing:0.3em;text-transform:lowercase;line-height:1;">${letters}</span>`
}
