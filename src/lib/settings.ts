import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * Typed access to app_settings.
 *
 * Spec §48 forbids inventing business rules, so every threshold the app reasons
 * with lives in the database and is editable in Settings. The fallbacks below
 * exist only so a missing row cannot crash a page — they are not the source of
 * truth, and Settings shows the stored value.
 */
const FALLBACKS = {
  idpms_closure_days: 90,
  default_followup_days: 7,
  upcoming_horizon_days: 7,
  goods_ready_grace_days: 0,
  eta_grace_days: 0,
  payment_total_tolerance: 0.01,
  business_timezone: 'Asia/Kolkata',
  comm_match_min_confidence: 0.6,
  comm_bundle_window_minutes: 10,
  // The WhatsApp message an operator copies when sending a freight quote
  // request. Seeded in migration 017; this is only the fallback if the row is
  // missing. Deliberately silent about PI and packing list — those are shared
  // separately by hand.
  freight_quote_message_template: [
    'Hello,',
    '',
    'Please submit your freight quotation for the following shipment.',
    '',
    'Import: {{import_no}}',
    'Mode: {{mode}}',
    'Origin: {{origin}}',
    'Destination: {{destination}}',
    'Gross weight: {{gross_weight}}',
    'Packages: {{package_count}}',
    '',
    'Submit your quotation here:',
    '{{quote_link}}',
    '',
    '{{deadline_line}}',
    'Thank you.',
  ].join('\n'),
  currencies: ['USD', 'EUR', 'GBP', 'CNY', 'CHF', 'JPY', 'SGD', 'AED', 'INR'],
  incoterms: ['EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'],
  drive_folder_template: [
    '01 PO & PI',
    '02 Payments',
    '03 Production',
    '04 Shipping Documents',
    '05 Freight & CHA',
    '06 Customs',
    '07 Delivery',
    '08 Costing',
    '09 Miscellaneous',
  ],
} as const

export type SettingKey = keyof typeof FALLBACKS

export async function getSettings(): Promise<Record<string, unknown>> {
  const supabase = await createClient()
  const { data } = await supabase.from('app_settings').select('key, value')

  const settings: Record<string, unknown> = { ...FALLBACKS }
  for (const row of data ?? []) {
    settings[row.key] = row.value
  }
  return settings
}

/** Fetch only the keys a page needs — avoids pulling every settings row. */
export async function getSettingsKeys<K extends SettingKey>(
  keys: readonly K[],
): Promise<Pick<Record<SettingKey, unknown>, K>> {
  const supabase = await createClient()
  const { data } = await supabase.from('app_settings').select('key, value').in('key', [...keys])

  const settings = {} as Pick<Record<SettingKey, unknown>, K>
  for (const key of keys) {
    settings[key] = FALLBACKS[key]
  }
  for (const row of data ?? []) {
    if ((keys as readonly string[]).includes(row.key)) {
      ;(settings as Record<string, unknown>)[row.key] = row.value
    }
  }
  return settings
}

export async function getSetting<K extends SettingKey>(
  key: K,
): Promise<(typeof FALLBACKS)[K]> {
  const supabase = await createClient()
  const { data } = await supabase.from('app_settings').select('value').eq('key', key).single()

  return (data?.value ?? FALLBACKS[key]) as (typeof FALLBACKS)[K]
}
