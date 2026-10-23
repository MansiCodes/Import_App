/**
 * Google Drive link handling.
 *
 * v1 stores links only — no OAuth, no API. The two Drive roots are owned by
 * different Google accounts (atlantatelecables@ and indianotofire@) with the
 * operator holding shared access, and the folder structure is days old, so
 * auto-creating folders across three accounts would be premature.
 *
 * Extracting the file id now means a later API phase can adopt every existing
 * row without asking anyone to re-paste a link.
 */

const ID_PATTERNS = [
  /\/file\/d\/([a-zA-Z0-9_-]{10,})/, // /file/d/<id>/view
  /\/folders\/([a-zA-Z0-9_-]{10,})/, // /drive/folders/<id>
  /\/document\/d\/([a-zA-Z0-9_-]{10,})/, // Docs
  /\/spreadsheets\/d\/([a-zA-Z0-9_-]{10,})/, // Sheets
  /[?&]id=([a-zA-Z0-9_-]{10,})/, // ?id=<id>
]

/** Pull the Drive file or folder id out of a pasted URL, or null. */
export function extractDriveId(url: string | null | undefined): string | null {
  if (!url) return null

  for (const pattern of ID_PATTERNS) {
    const match = url.match(pattern)
    if (match) return match[1]
  }

  return null
}

/** Is this plausibly a Google Drive link at all? */
export function isDriveUrl(url: string | null | undefined): boolean {
  if (!url) return false
  return /^https?:\/\/(drive|docs)\.google\.com\//.test(url.trim())
}
