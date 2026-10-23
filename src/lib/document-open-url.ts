import 'server-only'

/**
 * Prefer Drive; otherwise a same-origin open route that signs Storage on click.
 * Signing at render was an N+1 round-trip on every docs tab load.
 */
export function documentOpenHref(
  versionId: string,
  driveUrl: string | null,
  storagePath: string | null,
): string | null {
  if (driveUrl) return driveUrl
  if (storagePath) return `/api/docs/open/${versionId}`
  return null
}
