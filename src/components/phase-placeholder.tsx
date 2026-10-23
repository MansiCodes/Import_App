import { EmptyState, PageHeader } from '@/components/ui'

/**
 * Honest placeholder for a section the build has not reached yet.
 *
 * The nav lists every destination from spec §36 so the shape of the app is
 * visible from the start; this makes it plain which are still to come rather
 * than leaving a dead link or an empty screen that looks broken.
 */
export function PhasePlaceholder({
  title,
  description,
  phase,
}: {
  title: string
  description: string
  phase: string
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <EmptyState
        title={`Built in ${phase}`}
        description="This section is planned and its schema is designed — it just has not been built yet."
      />
    </>
  )
}
