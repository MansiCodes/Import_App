/**
 * The four roles, in descending order of authority. Matches the CHECK
 * constraint on profiles.role — adding one here means adding it there too.
 */
export const USER_ROLES = ['admin', 'import_manager', 'accounts', 'viewer'] as const

export type UserRole = (typeof USER_ROLES)[number]

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  import_manager: 'Import Manager',
  accounts: 'Accounts',
  viewer: 'Viewer',
}

/** What each role is for, shown next to the choice so it is an informed one. */
export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  admin: 'Full access, including managing users and access.',
  import_manager: 'Day-to-day running of imports, suppliers, shipments and documents.',
  accounts: 'Payments, costs and financial closure.',
  viewer: 'Read-only.',
}

export interface Profile {
  id: string
  email: string
  full_name: string | null
  role: UserRole
  is_active: boolean
}

export interface Company {
  id: string
  name: string
  legal_name: string | null
  short_code: string
  gstin: string | null
  iec: string | null
  fy_start_month: number
  po_number_template: string
  drive_folder_url: string | null
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface AppSetting {
  key: string
  value: unknown
  description: string
  updated_at: string
}

export interface PoSequence {
  company_id: string
  fy_label: string
  next_seq: number
}

export interface Supplier {
  id: string
  name: string
  legal_name: string | null
  country: string | null
  city: string | null
  default_currency: string | null
  default_incoterm: string | null
  payment_terms_text: string | null
  lead_time_days: number | null
  website: string | null
  notes: string | null
  is_active: boolean
}

export interface SupplierContact {
  id: string
  supplier_id: string
  name: string
  role: string | null
  email: string | null
  phone: string | null
  whatsapp: string | null
  is_primary: boolean
  notes: string | null
  is_active: boolean
}

export interface SupplierBankAccount {
  id: string
  supplier_id: string
  beneficiary_name: string
  bank_name: string
  account_no: string | null
  iban: string | null
  swift: string | null
  bank_address: string | null
  intermediary_bank: string | null
  intermediary_swift: string | null
  currency: string | null
  effective_from: string
  is_current: boolean
  superseded_by_id: string | null
  verification_status: 'received' | 'verified' | 'rejected'
  verified_at: string | null
  verification_remarks: string | null
  source_note: string | null
  created_at: string
}

export interface Cha {
  id: string
  name: string
  company_name: string | null
  contact_person: string | null
  email: string | null
  phone: string | null
  /** Added in migration 017 for freight quote distribution. */
  whatsapp_phone: string | null
  /** Recorded for later — the official Cloud API cannot address a group. */
  whatsapp_group_id: string | null
  address: string | null
  notes: string | null
  is_active: boolean
}

export interface ChaAgent {
  id: string
  cha_id: string
  name: string
  country: string | null
  city: string | null
  contact_person: string | null
  email: string | null
  phone: string | null
  whatsapp_phone: string | null
  modes: string[]
  notes: string | null
  is_active: boolean
}

export const PAYMENT_STATUSES = [
  'Planned',
  'Due',
  'Approval Required',
  'Approved',
  'Payment Initiated',
  'Paid',
  'Supplier Confirmed',
  'Cancelled',
  'Refunded',
] as const

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

/** Statuses that mean the money has left — reaching these needs confirmation. */
export const PAID_STATUSES: readonly PaymentStatus[] = ['Paid', 'Supplier Confirmed']

export interface ImportPayment {
  id: string
  import_id: string
  seq: number
  description: string
  payment_condition: string | null
  currency: string
  planned_amount: string
  percentage: string | null
  due_date: string | null
  status: PaymentStatus
  requested_at: string | null
  approved_at: string | null
  paid_amount: string | null
  paid_at: string | null
  fx_rate: string | null
  inr_amount: string | null
  bank_reference: string | null
  swift_reference: string | null
  bank_account_id: string | null
  is_advance: boolean
  boe_submitted_to_bank_at: string | null
  idpms_notes: string | null
  notes: string | null
}

export interface Refund {
  id: string
  import_id: string
  payment_id: string | null
  currency: string
  amount: string
  reason: string | null
  status: 'Expected' | 'Requested' | 'Received' | 'Cancelled'
  requested_at: string | null
  received_at: string | null
  bank_reference: string | null
  notes: string | null
}

export interface DocumentType {
  id: string
  code: string
  name: string
  category: string
  is_system: boolean
  sort_order: number
  is_active: boolean
}

/**
 * Primary import document tabs. `slug` is the URL segment under /docs/[code].
 * `typeCodes` maps to document_types.code — transport covers AWB and BL.
 * `shortLabel` is for the tab bar; `label` is the page title.
 */
export const PRIMARY_DOCUMENT_TABS = [
  { slug: 'po', shortLabel: 'PO', label: 'Purchase order', typeCodes: ['po'] },
  { slug: 'pi', shortLabel: 'PI', label: 'Proforma invoice', typeCodes: ['pi'] },
  {
    slug: 'transport',
    shortLabel: 'AWB / BL',
    label: 'Airway bill / Bill of lading',
    typeCodes: ['awb', 'bl'],
  },
  {
    slug: 'commercial_invoice',
    shortLabel: 'Commercial invoice',
    label: 'Commercial invoice',
    typeCodes: ['commercial_invoice'],
  },
  {
    slug: 'packing_list',
    shortLabel: 'Packing list',
    label: 'Packing list',
    typeCodes: ['packing_list'],
  },
  {
    slug: 'insurance',
    shortLabel: 'Insurance',
    label: 'Insurance certificate',
    typeCodes: ['insurance'],
  },
  { slug: 'boe', shortLabel: 'BOE', label: 'Bill of entry', typeCodes: ['boe'] },
  { slug: 'oocc', shortLabel: 'OOCC', label: 'Out of charge copy', typeCodes: ['oocc'] },
  { slug: 'gate_pass', shortLabel: 'Gate pass', label: 'Gate pass', typeCodes: ['gate_pass'] },
  {
    slug: 'material_receipt',
    shortLabel: 'Material receipt',
    label: 'Material receipt',
    typeCodes: ['material_receipt'],
  },
  { slug: 'eway_bill', shortLabel: 'E-way bill', label: 'E-way bill', typeCodes: ['eway_bill'] },
  {
    slug: 'cha_bill',
    shortLabel: 'CHA bill',
    label: 'CHA freight bill',
    typeCodes: ['cha_bill'],
  },
  {
    slug: 'terminal_receipt',
    shortLabel: 'Terminal',
    label: 'Terminal charges',
    typeCodes: ['terminal_receipt'],
  },
  {
    slug: 'swift_copy',
    shortLabel: 'SWIFT',
    label: 'Payment / SWIFT copy',
    typeCodes: ['swift_copy'],
  },
  { slug: 'misc', shortLabel: 'Other', label: 'Other documents', typeCodes: ['misc'] },
] as const

export type PrimaryDocumentSlug = (typeof PRIMARY_DOCUMENT_TABS)[number]['slug']

export function getPrimaryDocumentTab(slug: string) {
  return PRIMARY_DOCUMENT_TABS.find((tab) => tab.slug === slug) ?? null
}

export const CHECKLIST_GATES = [
  'before_payment',
  'before_pickup',
  'before_shipment',
  'customs',
  'post_clearance',
] as const

export type ChecklistGate = (typeof CHECKLIST_GATES)[number]

export const GATE_LABELS: Record<ChecklistGate, string> = {
  before_payment: 'Before payment',
  before_pickup: 'Before pickup',
  before_shipment: 'Before shipment',
  customs: 'Customs',
  post_clearance: 'After clearance',
}

export interface ChecklistRow {
  id: string
  import_id: string
  document_type_id: string
  type_code: string
  type_name: string
  category: string
  gate: ChecklistGate
  requirement: 'required' | 'optional' | 'not_applicable'
  notes: string | null
  sort_order: number
  document_id: string | null
  version_id: string | null
  version_no: number | null
  drive_url: string | null
  file_name: string | null
  received_at: string | null
  verification_status: 'received' | 'verified' | 'rejected' | null
  state: 'pending' | 'received' | 'verified' | 'rejected' | 'not_applicable'
}

export interface VerificationItem {
  import_id: string
  kind: 'document' | 'bank_account' | 'payment_schedule'
  record_id: string
  title: string
  detail: string | null
  since: string
  priority: string
}

/**
 * Verification state shared by every record a human must confirm (spec §34).
 * `received` / `verified` applies to documents and figures that arrive from
 * outside; `calculated` / `approved` applies to values the system derived.
 */
export type VerificationStatus =
  | 'pending'
  | 'received'
  | 'calculated'
  | 'verified'
  | 'approved'
  | 'rejected'

// ---------------------------------------------------------------------------
// Production (phase 5)
// ---------------------------------------------------------------------------

export const PRODUCTION_STAGES = [
  'Not started',
  'Materials',
  'In production',
  'Assembly',
  'Testing',
  'Inspection',
  'Packing',
  'Ready',
] as const

export type ProductionStage = (typeof PRODUCTION_STAGES)[number]

export interface ProductionUpdate {
  id: string
  import_id: string
  reported_on: string
  source: string | null
  stage: ProductionStage | null
  percent_complete: string | null
  promised_ready_date: string | null
  detail: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Shipments (phase 6)
// ---------------------------------------------------------------------------

export const SHIPMENT_MODES = ['air', 'sea', 'courier', 'road'] as const
export type ShipmentMode = (typeof SHIPMENT_MODES)[number]

export const SHIPMENT_STATUSES = [
  'Planned',
  'Booked',
  'Picked Up',
  'In Transit',
  'Arrived',
  'Customs Cleared',
  'Delivered',
  'Cancelled',
] as const

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number]

/**
 * Which identifier fields a mode actually uses. A courier consignment has a
 * tracking number and nothing else; asking it for a bill of lading is how a
 * form stops being usable.
 */
export const MODE_FIELDS: Record<ShipmentMode, readonly string[]> = {
  air: ['awb', 'hawb', 'mawb', 'vessel_flight', 'chargeable_weight_kg'],
  sea: ['bl_no', 'bl_date', 'vessel_flight', 'container_nos', 'container_count', 'cbm'],
  courier: ['tracking_no'],
  road: ['vessel_flight', 'container_nos'],
}

export interface Shipment {
  id: string
  import_id: string
  seq: number
  shipment_no: string | null
  description: string | null
  mode: ShipmentMode
  cha_id: string | null
  cha_agent_id: string | null
  origin_country: string | null
  origin_port: string | null
  destination_port: string | null
  incoterm: string | null
  pickup_date: string | null
  etd: string | null
  eta: string | null
  revised_eta: string | null
  actual_arrival: string | null
  carrier: string | null
  vessel_flight: string | null
  awb: string | null
  hawb: string | null
  mawb: string | null
  bl_no: string | null
  bl_date: string | null
  tracking_no: string | null
  container_nos: string | null
  container_count: number | null
  packages: number | null
  package_type: string | null
  gross_weight_kg: string | null
  net_weight_kg: string | null
  chargeable_weight_kg: string | null
  cbm: string | null
  status: ShipmentStatus
  freight_terms: string | null
  notes: string | null
}

export interface ShipmentBoardRow extends Shipment {
  effective_eta: string | null
  days_to_eta: number | null
  eta_revised: boolean
  import_no: string
  import_status: string
  is_archived: boolean
  company_name: string
  company_code: string
  supplier_name: string | null
  cha_name: string | null
  agent_name: string | null
}

// ---------------------------------------------------------------------------
// Customs and delivery (phase 8)
// ---------------------------------------------------------------------------

export const QUERY_STATUSES = ['none', 'open', 'replied', 'closed'] as const
export type QueryStatus = (typeof QUERY_STATUSES)[number]

export interface CustomsRecord {
  id: string
  shipment_id: string
  import_id: string
  boe_no: string | null
  boe_date: string | null
  boe_type: string | null
  port_code: string | null
  icegate_ref: string | null
  assessable_value: string | null
  exchange_rate: string | null
  bcd: string | null
  sws: string | null
  igst: string | null
  compensation_cess: string | null
  other_duty: string | null
  total_duty: string | null
  duty_paid_at: string | null
  duty_challan_no: string | null
  query_text: string | null
  query_raised_at: string | null
  query_status: QueryStatus
  query_replied_at: string | null
  examination_at: string | null
  oocc_at: string | null
  cleared_at: string | null
  gate_pass_no: string | null
  eway_bill_no: string | null
  eway_bill_valid_till: string | null
  boe_verification_status: 'pending' | 'received' | 'verified' | 'rejected'
  boe_verified_at: string | null
  duty_verification_status: 'pending' | 'calculated' | 'verified' | 'approved' | 'rejected'
  duty_verified_at: string | null
  verification_remarks: string | null
  notes: string | null
}

export interface DeliveryRecord {
  id: string
  shipment_id: string
  import_id: string
  transporter: string | null
  lr_no: string | null
  vehicle_no: string | null
  dispatched_at: string | null
  expected_delivery: string | null
  actual_delivery: string | null
  delivery_location: string | null
  received_by: string | null
  material_receipt_at: string | null
  mrn_no: string | null
  has_shortage: boolean
  has_damage: boolean
  discrepancy_notes: string | null
  shortage_qty: string | null
  notes: string | null
}

// ---------------------------------------------------------------------------
// Tasks (phase 9)
// ---------------------------------------------------------------------------

export const TASK_STATUSES = ['Open', 'In Progress', 'Blocked', 'Done', 'Cancelled'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TASK_CATEGORIES = [
  'Follow-up',
  'Document',
  'Payment',
  'Shipping',
  'Customs',
  'Delivery',
  'Compliance',
  'Internal',
  'Other',
] as const

export const EXTERNAL_PARTIES = [
  'Supplier',
  'CHA',
  'Overseas Agent',
  'Bank',
  'Customs',
  'Transporter',
  'Insurance',
  'Other',
] as const

export const PRIORITIES = ['low', 'normal', 'high', 'critical'] as const
export type Priority = (typeof PRIORITIES)[number]

export interface Task {
  id: string
  import_id: string | null
  title: string
  description: string | null
  category: string | null
  owner_id: string | null
  external_party: string | null
  due_date: string | null
  priority: Priority
  status: TaskStatus
  completed_at: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Email templates (phase 10)
// ---------------------------------------------------------------------------

export interface EmailTemplate {
  id: string
  code: string
  name: string
  category: string | null
  subject: string
  body: string
  placeholders: string[]
  is_system: boolean
  is_active: boolean
  sort_order: number
}

export interface EmailDraft {
  id: string
  import_id: string | null
  template_id: string | null
  to_email: string | null
  cc_email: string | null
  subject: string
  body: string
  prepared_at: string
  sent_manually_at: string | null
  gmail_thread_url: string | null
}

// ---------------------------------------------------------------------------
// Landed cost and closure (phase 11)
// ---------------------------------------------------------------------------

export const COST_TYPES = [
  'product',
  'freight',
  'insurance',
  'duty',
  'cha',
  'handling',
  'terminal',
  'transport',
  'bank_fx',
  'other',
] as const

export type CostType = (typeof COST_TYPES)[number]

export const COST_TYPE_LABELS: Record<CostType, string> = {
  product: 'Product',
  freight: 'Freight',
  insurance: 'Insurance',
  duty: 'Customs duty',
  cha: 'CHA charges',
  handling: 'Handling',
  terminal: 'Terminal',
  transport: 'Inland transport',
  bank_fx: 'Bank & FX charges',
  other: 'Other',
}

export interface ImportCost {
  id: string
  import_id: string
  shipment_id: string | null
  cost_type: CostType
  description: string | null
  vendor: string | null
  currency: string
  amount: string
  fx_rate: string | null
  inr_amount: string | null
  is_estimate: boolean
  incurred_on: string | null
  invoice_no: string | null
  notes: string | null
  logistics_invoice_id?: string | null
  shipment_seq?: number | null
  shipment_no?: string | null
  needs_rate?: boolean
}

export interface LandedCost {
  import_id: string
  line_count: number
  unconverted_count: number
  estimate_count: number
  inr_total: string
  inr_actual_total: string
  inr_estimate_total: string
  inr_product: string
  inr_freight: string
  inr_insurance: string
  inr_duty: string
  inr_cha: string
  inr_other: string
  landed_cost_status: 'none' | 'calculated' | 'approved'
  landed_cost_verified_at: string | null
}

export interface LandedCostByCurrency {
  import_id: string
  currency: string
  amount_total: string
  inr_total: string
  line_count: number
  unconverted_count: number
}

// --- Communications --------------------------------------------------------

export const COMMUNICATION_STATUSES = [
  'new',
  'in_review',
  'actioned',
  'ignored',
  'archived',
] as const
export type CommunicationStatus = (typeof COMMUNICATION_STATUSES)[number]

export const COMMUNICATION_STATUS_LABELS: Record<CommunicationStatus, string> = {
  new: 'Needs review',
  in_review: 'In review',
  actioned: 'Actioned',
  ignored: 'Ignored',
  archived: 'Archived',
}

export const SENDER_ROLES = [
  'Supplier',
  'CHA',
  'Overseas Agent',
  'Bank',
  'Customs',
  'Transporter',
  'Insurance',
  'Internal',
  'Unknown',
] as const
export type SenderRole = (typeof SENDER_ROLES)[number]

export const MATCH_STATUSES = [
  'unmatched',
  'ambiguous',
  'proposed',
  'confirmed',
  'rejected',
] as const
export type MatchStatus = (typeof MATCH_STATUSES)[number]

export interface Communication {
  id: string
  source: 'whatsapp' | 'gmail' | 'manual'
  provider: string | null
  provider_message_id: string | null
  direction: 'inbound' | 'outbound'
  forwarded_by_phone: string | null
  forwarded_by_name: string | null
  sender_phone: string | null
  sender_name: string | null
  sender_role: SenderRole | null
  sender_supplier_id: string | null
  sender_contact_id: string | null
  sender_cha_id: string | null
  sender_cha_agent_id: string | null
  sender_match_method: 'phone_exact' | 'phone_suffix' | 'manual' | 'none' | null
  message_type: string
  body_text: string | null
  sent_at: string | null
  received_at: string
  status: CommunicationStatus
  import_id: string | null
  linked_at: string | null
  notes: string | null
}

export interface CommunicationAttachment {
  id: string
  communication_id: string
  provider_media_id: string | null
  file_name: string | null
  mime_type: string | null
  size_bytes: number | null
  caption: string | null
  storage: 'none' | 'supabase' | 'drive'
  drive_url: string | null
  fetch_status: 'not_fetched' | 'fetched' | 'expired' | 'failed' | 'skipped'
  provider_expires_at: string | null
  document_id: string | null
}

/** What the matcher believed, and why. Never the same thing as a human's link. */
export interface CommunicationParse {
  id: string
  provider_name: string
  provider_version: string
  status: 'pending' | 'parsed' | 'failed' | 'superseded'
  failure_reason: string | null
  matched_import_id: string | null
  match_confidence: string | null
  match_signals: { signals?: MatchSignal[]; alternatives?: MatchAlternative[] } | null
  match_status: MatchStatus
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH'
  parsed_at: string | null
}

export interface MatchSignal {
  kind: string
  value: string
  weight: number
}

export interface MatchAlternative {
  importId: string
  importNo: string
  confidence: number
  signals: MatchSignal[]
}

/** One row of v_communication_inbox. */
export interface InboxRow {
  id: string
  source: string
  provider: string | null
  message_type: string
  body_text: string | null
  forwarded_by_phone: string | null
  sender_phone: string | null
  sender_name: string | null
  sender_role: SenderRole | null
  sent_at: string | null
  received_at: string
  status: CommunicationStatus
  import_id: string | null
  linked_at: string | null
  import_no: string | null
  import_status: string | null
  supplier_name: string | null
  parse_id: string | null
  parse_status: 'pending' | 'parsed' | 'failed' | 'superseded' | null
  failure_reason: string | null
  matched_import_id: string | null
  match_confidence: string | null
  match_status: MatchStatus | null
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | null
  matched_import_no: string | null
  suggestion_count: number | null
  open_suggestion_count: number | null
  attachment_count: number
}

// ---------------------------------------------------------------------------
// Freight quotes (FQ)
// ---------------------------------------------------------------------------

export const FREIGHT_MODES = ['AIR', 'SEA_LCL'] as const
export type FreightMode = (typeof FREIGHT_MODES)[number]

export const FREIGHT_MODE_LABELS: Record<string, string> = {
  AIR: 'Air',
  SEA_LCL: 'Sea LCL',
  SEA_FCL: 'Sea FCL',
  COURIER: 'Courier',
}

export const QUOTE_REQUEST_STATUSES = [
  'Draft',
  'Open',
  'Partially Submitted',
  'Complete',
  'Closed',
  'Cancelled',
] as const
export type QuoteRequestStatus = (typeof QUOTE_REQUEST_STATUSES)[number]

export const RECIPIENT_STATUSES = [
  'Pending',
  'Sent',
  'Viewed',
  'Submitted',
  'Revised',
  'Declined',
  'Revoked',
] as const
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number]

export interface FreightChargeType {
  id: string
  code: string
  name: string
  applies_to: string[]
  default_method: string | null
  costing_bucket?: string | null
  sort_order: number
  is_active: boolean
}

export interface FreightQuoteRequest {
  id: string
  import_id: string
  shipment_id: string | null
  request_no: string
  mode: string
  status: QuoteRequestStatus
  origin: string | null
  destination: string | null
  incoterm: string | null
  cargo_description: string | null
  gross_weight_kg: string | null
  net_weight_kg: string | null
  chargeable_weight_kg: string | null
  cbm: string | null
  package_count: number | null
  pallet_count: number | null
  request_notes: string | null
  response_deadline: string | null
  comparison_currency: string
  selected_quote_id: string | null
  selected_at: string | null
  selection_reason: string | null
  closed_at: string | null
  created_at: string
}

export interface FreightQuoteRequestSummary extends FreightQuoteRequest {
  import_no: string
  company_code: string
  supplier_name: string | null
  recipient_count: number
  submitted_count: number
  pending_count: number
  viewed_count: number
}

export interface FreightQuoteRecipient {
  id: string
  quote_request_id: string
  cha_id: string | null
  agent_id: string | null
  recipient_name: string
  phone: string | null
  email: string | null
  token: string
  token_expires_at: string | null
  revoked_at: string | null
  status: RecipientStatus
  sent_at: string | null
  first_viewed_at: string | null
  last_viewed_at: string | null
  submitted_at: string | null
  latest_quote_id: string | null
  reminder_count: number
  last_reminder_at: string | null
  decline_reason: string | null
}

export interface FreightQuoteRow {
  id: string
  quote_request_id: string
  recipient_id: string
  version_no: number
  is_current: boolean
  carrier: string | null
  routing: string | null
  transit_time: string | null
  schedule_note: string | null
  free_days: number | null
  origin: string | null
  destination: string | null
  incoterm: string | null
  gross_weight_kg: string | null
  chargeable_weight_kg: string | null
  cbm: string | null
  package_count: number | null
  pallet_count: number | null
  currency: string
  agent_fx_rate: string | null
  agent_quoted_total: string | null
  validity_date: string | null
  remarks: string | null
  submitted_at: string
}

export interface FreightQuoteChargeRow {
  id: string
  quote_id: string
  charge_type: string
  custom_label: string | null
  currency: string
  calculation_method: string
  charge_status: string
  rate: string | null
  quantity: string | null
  quantity_unit: string | null
  total_amount: string | null
  remarks: string | null
  sort_order: number
}

// ---------------------------------------------------------------------------
// Product-wise costing
// ---------------------------------------------------------------------------

export interface ShipmentCargoLine {
  id: string
  import_id: string
  shipment_id: string
  import_item_id: string | null
  sku: string | null
  product_code: string | null
  description: string
  quantity: string | null
  unit: string | null
  gross_weight_kg: string | null
  net_weight_kg: string | null
  cbm: string | null
  packages: string | null
  unit_value: string | null
  line_value: string | null
  currency: string | null
  packing_list_ref: string | null
  sort_order: number
}

export interface LogisticsInvoice {
  id: string
  import_id: string
  shipment_id: string
  vendor: string | null
  invoice_no: string | null
  invoice_date: string | null
  currency: string
  subtotal: string | null
  tax_total: string | null
  grand_total: string
  source_document_id: string | null
  import_cost_id: string | null
  notes: string | null
  created_at: string
}

export interface LogisticsInvoiceCharge {
  id: string
  invoice_id: string
  charge_type_id: string
  description: string | null
  is_tax: boolean
  amount: string
  currency: string
  allocation_basis: string
  sort_order: number
  charge_code?: string
  charge_name?: string
  costing_bucket?: string | null
}

export interface CargoLineCosting {
  cargo_line_id: string
  import_id: string
  shipment_id: string
  sku: string | null
  product_code: string | null
  description: string
  quantity: string | null
  unit: string | null
  gross_weight_kg: string | null
  net_weight_kg: string | null
  cbm: string | null
  packages: string | null
  unit_value: string | null
  line_value: string | null
  product_currency: string | null
  packing_list_ref: string | null
  shipment_seq: number
  shipment_no: string | null
  bl_no: string | null
  awb: string | null
  hawb: string | null
  mawb: string | null
  freight_alloc: string
  bl_awb_alloc: string
  cha_alloc: string
  local_alloc: string
  other_alloc: string
  tax_alloc: string
  total_logistics: string
  logistics_per_unit: string | null
  landed_cost: string
}

export interface ShipmentCostingSummary {
  shipment_id: string
  import_id: string
  shipment_seq: number
  shipment_no: string | null
  bl_no: string | null
  awb: string | null
  hawb: string | null
  mawb: string | null
  shipment_gross_weight_kg: string | null
  shipment_cbm: string | null
  product_count: number
  total_quantity: string
  cargo_gross_weight_kg: string
  product_value_total: string
  invoice_grand_total: string
  charges_total: string
  allocated_total: string
  invoice_charge_gap: string
  unallocated_amount: string
}

export interface QuoteVsActualRow {
  import_id: string
  shipment_id: string | null
  request_id: string | null
  charge_code: string
  charge_name: string
  costing_bucket: string | null
  quote_currency: string | null
  actual_currency: string | null
  quoted_amount: string
  actual_amount: string
  diff_amount: string
  diff_pct: string | null
}
