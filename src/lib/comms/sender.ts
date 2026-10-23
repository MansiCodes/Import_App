/**
 * Who sent this?
 *
 * The schema holds exactly four phone numbers anywhere: supplier_contacts.phone,
 * supplier_contacts.whatsapp, chas.phone and cha_agents.phone. There is no phone
 * for a bank, for customs, for insurance, or for a transporter —
 * delivery_records.transporter is free text with no master record behind it.
 *
 * So `Unknown` is going to be the honest answer for a large share of real
 * messages, and that is correct. Manufacturing a role from a message's contents
 * would put a name to a promise on no evidence at all. If the operator wants
 * those parties recognised, that is a masters change with its own decision to
 * make, not something this module should infer.
 *
 * A forwarded message is a further trap: the payload's sender is the OPERATOR'S
 * own handset. Whoever actually wrote the words is often not in the metadata at
 * all, and is never invented here.
 */

export type SenderRole =
  | 'Supplier'
  | 'CHA'
  | 'Overseas Agent'
  | 'Bank'
  | 'Customs'
  | 'Transporter'
  | 'Insurance'
  | 'Internal'
  | 'Unknown'

export type SenderMatchMethod = 'phone_exact' | 'phone_suffix' | 'manual' | 'none'

/** One row from the four phone-bearing tables, flattened. */
export interface DirectoryEntry {
  role: SenderRole
  phone: string | null | undefined
  name?: string | null
  supplierId?: string | null
  contactId?: string | null
  chaId?: string | null
  chaAgentId?: string | null
}

export interface SenderMatch {
  role: SenderRole
  method: SenderMatchMethod
  name: string | null
  supplierId: string | null
  contactId: string | null
  chaId: string | null
  chaAgentId: string | null
}

/**
 * How many trailing digits count as the same number.
 *
 * Numbers are stored however somebody typed them — +86 138 0000 0000,
 * 008613800000000, 13800000000 — so a full-string comparison misses constantly.
 * Nine is long enough that a collision means two genuinely similar numbers, and
 * short enough to survive any country-code prefix.
 */
const SUFFIX_DIGITS = 9

/** Everything that is not a digit is presentation, not identity. */
export function normalisePhone(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '')
}

/**
 * Trailing digits used for the fuzzy pass. An international prefix may be
 * written as 00 or dropped entirely, so only the tail is dependable.
 */
export function phoneSuffix(value: string | null | undefined, digits = SUFFIX_DIGITS): string {
  const normalised = normalisePhone(value)
  return normalised.length >= digits ? normalised.slice(-digits) : ''
}

export function identifySender(
  phone: string | null | undefined,
  directory: DirectoryEntry[],
): SenderMatch {
  const target = normalisePhone(phone)
  if (!target) return unknown()

  const exact = directory.filter((entry) => normalisePhone(entry.phone) === target)
  if (exact.length === 1) return resolved(exact[0], 'phone_exact')

  // Two directory rows holding the same number is a data problem, not a
  // licence to pick one.
  if (exact.length > 1) return unknown()

  const suffix = phoneSuffix(phone)
  if (!suffix) return unknown()

  const near = directory.filter((entry) => phoneSuffix(entry.phone) === suffix)

  // Only when it narrows to exactly one. Several near-matches is ambiguity, and
  // ambiguity resolves to Unknown so the operator sets it themselves.
  return near.length === 1 ? resolved(near[0], 'phone_suffix') : unknown()
}

function resolved(entry: DirectoryEntry, method: SenderMatchMethod): SenderMatch {
  return {
    role: entry.role,
    method,
    name: entry.name ?? null,
    supplierId: entry.supplierId ?? null,
    contactId: entry.contactId ?? null,
    chaId: entry.chaId ?? null,
    chaAgentId: entry.chaAgentId ?? null,
  }
}

function unknown(): SenderMatch {
  return {
    role: 'Unknown',
    method: 'none',
    name: null,
    supplierId: null,
    contactId: null,
    chaId: null,
    chaAgentId: null,
  }
}
