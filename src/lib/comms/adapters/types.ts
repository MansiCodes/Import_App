/**
 * The seam between a messaging provider and this application.
 *
 * Everything downstream — matching, parsing, the Inbox — reads `InboundMessage`
 * and has never seen a provider payload. That is the point: the business logic
 * must not learn the shape of Meta's JSON, or swapping provider becomes a
 * rewrite rather than a file.
 *
 * The provider's own payload is still kept verbatim on `communications.raw_payload`,
 * because when a parse looks wrong the first question is always "what did they
 * actually send us?".
 */

export type InboundMessageType =
  | 'text'
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'contact'
  | 'location'
  | 'other'

export interface InboundAttachment {
  providerMediaId: string | null
  fileName: string | null
  mimeType: string | null
  sizeBytes: number | null
  sha256: string | null
  caption: string | null
}

export interface InboundMessage {
  provider: string
  providerMessageId: string

  /**
   * Who handed this to us. On a forwarded message that is the operator's own
   * handset, not the supplier — which is exactly why it is a separate field.
   */
  forwardedByPhone: string | null
  forwardedByName: string | null

  /**
   * Who wrote it, when the provider actually says so. A forwarded message
   * carries no original sender in the payload, so this is null and stays null.
   * Never inferred from the text.
   */
  senderPhone: string | null
  senderName: string | null

  forwarded: boolean
  messageType: InboundMessageType
  bodyText: string | null

  /** The provider's timestamp. Relative dates are resolved against this. */
  sentAt: string | null

  attachments: InboundAttachment[]
  raw: unknown
}

export interface WhatsAppProviderAdapter {
  readonly name: string

  /**
   * The subscription handshake. Returns the challenge to echo, or null to
   * refuse — the caller answers 403 on null and never explains why.
   */
  verifyChallenge(params: URLSearchParams): string | null

  /**
   * Is this request really from the provider?
   *
   * Takes the RAW body string. It must be the exact bytes received: parsing and
   * re-serialising changes key order and whitespace, and the signature is over
   * what was sent, not over what it meant.
   */
  verifySignature(rawBody: string, headers: Headers): boolean

  /** Provider payload to zero or more internal messages. Must never throw. */
  toInbound(payload: unknown): InboundMessage[]
}

// ---------------------------------------------------------------------------
// Outbound
// ---------------------------------------------------------------------------

/**
 * A delivery state the provider reported for a message we sent.
 *
 * Deliberately narrow: this is communication metadata and must never reach
 * quote or comparison logic. A delivered message says nothing about whether a
 * quotation was given.
 */
export interface DeliveryStatus {
  providerMessageId: string
  state: 'sent' | 'delivered' | 'read' | 'failed'
  at: string | null
  errorCode: string | null
  errorReason: string | null
}

export interface SendResult {
  ok: boolean
  providerMessageId: string | null
  errorCode: string | null
  errorReason: string | null
}

/** Ordered values substituted into an approved template's body placeholders. */
export type TemplateParameters = string[]

/**
 * The outbound half of a provider.
 *
 * Optional on the interface on purpose: a provider that can only receive is
 * still a valid provider, and the freight quote module checks for the
 * capability rather than assuming every adapter can send.
 */
export interface WhatsAppSender {
  /**
   * A business-initiated message. Requires a template approved by the provider
   * — free-form text to somebody who has not written to us first is rejected.
   */
  sendTemplate(params: {
    to: string
    templateName: string
    languageCode: string
    parameters: TemplateParameters
  }): Promise<SendResult>

  /**
   * Free-form text. Valid ONLY inside an open 24-hour service window, which a
   * cold quote request will not normally have. Present so the seam is complete,
   * not because it is the usual path.
   */
  sendText(params: { to: string; body: string }): Promise<SendResult>

  /** Delivery and read callbacks from the provider's webhook payload. */
  parseDeliveryStatuses(payload: unknown): DeliveryStatus[]
}
