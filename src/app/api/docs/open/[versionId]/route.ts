import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUser } from '@/lib/supabase/auth'

const BUCKET = 'import-documents'

/**
 * Redirect to the file: Drive link as-is, or a short-lived Storage signed URL.
 * Auth is checked here so we never mint public Storage URLs at page render.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ versionId: string }> },
) {
  const user = await getUser()
  if (!user) {
    return NextResponse.redirect(new URL('/login', _request.url))
  }

  const { versionId } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('document_versions')
    .select('drive_url, storage_path')
    .eq('id', versionId)
    .maybeSingle()

  if (error || !data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (data.drive_url) {
    return NextResponse.redirect(data.drive_url)
  }

  if (!data.storage_path) {
    return NextResponse.json({ error: 'No file' }, { status: 404 })
  }

  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(data.storage_path, 60 * 10)

  if (signError || !signed?.signedUrl) {
    return NextResponse.json({ error: signError?.message ?? 'Sign failed' }, { status: 500 })
  }

  return NextResponse.redirect(signed.signedUrl)
}
