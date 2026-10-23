import 'server-only'

/**
 * The narrow slice of the database that matching needs.
 *
 * Loaded once per pipeline run and handed to pure functions, so the matcher
 * itself stays testable without a database — the same shape as the other
 * engines in src/lib.
 *
 * This is a handful of small selects rather than a clever query because the
 * identifiers involved are free text with real-world noise, and normalising
 * them is TypeScript's job (see the comment at the foot of migration 015 for
 * the expression index that would be needed if this ever ran hot).
 */

import { isActive } from '@/lib/import-status'
import { createClient } from '@/lib/supabase/server'
import type { MatchCandidate } from './matcher'
import type { DirectoryEntry } from './sender'

export interface Snapshot {
  candidates: MatchCandidate[]
  directory: DirectoryEntry[]
}

export async function loadSnapshot(): Promise<Snapshot> {
  const supabase = await createClient()

  const [importsResult, shipmentsResult, customsResult, contactsResult, chasResult, agentsResult] =
    await Promise.all([
      supabase.from('imports').select('id, import_no, po_number, pi_number, supplier_id, status'),
      supabase
        .from('shipments')
        .select('import_id, awb, hawb, mawb, bl_no, tracking_no, container_nos'),
      supabase.from('customs_records').select('import_id, boe_no'),
      supabase
        .from('supplier_contacts')
        .select('id, supplier_id, name, phone, whatsapp')
        .eq('is_active', true),
      supabase.from('chas').select('id, name, phone').eq('is_active', true),
      supabase.from('cha_agents').select('id, cha_id, name, phone').eq('is_active', true),
    ])

  const shipments = shipmentsResult.data ?? []
  const customs = customsResult.data ?? []

  const candidates: MatchCandidate[] = (importsResult.data ?? []).map((row) => {
    const own = shipments.filter((s) => s.import_id === row.id)

    return {
      importId: row.id,
      importNo: row.import_no,
      poNumber: row.po_number,
      piNumber: row.pi_number,
      supplierId: row.supplier_id,
      isActive: isActive(row.status),
      awbs: own.flatMap((s) => [s.awb, s.hawb, s.mawb]),
      blNumbers: own.map((s) => s.bl_no),
      trackingNumbers: own.map((s) => s.tracking_no),
      containerNumbers: own.map((s) => s.container_nos),
      boeNumbers: customs.filter((c) => c.import_id === row.id).map((c) => c.boe_no),
    }
  })

  // The only four phone numbers the schema holds anywhere. A contact may have
  // both a landline and a WhatsApp number, and either could be the sender.
  const directory: DirectoryEntry[] = [
    ...(contactsResult.data ?? []).flatMap((row) =>
      [row.phone, row.whatsapp].map((phone) => ({
        role: 'Supplier' as const,
        phone,
        name: row.name,
        supplierId: row.supplier_id,
        contactId: row.id,
      })),
    ),
    ...(chasResult.data ?? []).map((row) => ({
      role: 'CHA' as const,
      phone: row.phone,
      name: row.name,
      chaId: row.id,
    })),
    ...(agentsResult.data ?? []).map((row) => ({
      role: 'Overseas Agent' as const,
      phone: row.phone,
      name: row.name,
      chaId: row.cha_id,
      chaAgentId: row.id,
    })),
  ].filter((entry) => Boolean(entry.phone))

  return { candidates, directory }
}
