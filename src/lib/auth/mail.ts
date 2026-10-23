import 'server-only'

import nodemailer from 'nodemailer'

/**
 * Password reset is the only auth email. Login does not send one, so it does
 * not depend on Supabase's built-in mail quota.
 *
 * Delivery uses the application's own SMTP settings. Nothing here reads a
 * NEXT_PUBLIC variable, and the message body is never logged.
 */
export function resetMailConfigured(): boolean {
  return Boolean(process.env.AUTH_SMTP_HOST && process.env.AUTH_SMTP_FROM)
}

export async function sendResetEmail(to: string, link: string): Promise<void> {
  const host = process.env.AUTH_SMTP_HOST
  const from = process.env.AUTH_SMTP_FROM
  if (!host || !from) {
    throw new Error('MAIL_NOT_CONFIGURED')
  }

  const port = Number(process.env.AUTH_SMTP_PORT ?? 587)
  const secure = process.env.AUTH_SMTP_SECURE === 'true' || port === 465
  const user = process.env.AUTH_SMTP_USER
  const pass = process.env.AUTH_SMTP_PASSWORD

  const transporter = nodemailer.createTransport({
    host,
    port: Number.isFinite(port) ? port : 587,
    secure,
    auth: user ? { user, pass: pass ?? '' } : undefined,
  })

  await transporter.sendMail({
    from,
    to,
    subject: 'Reset your Import Control Tower password',
    text: [
      'A password reset was requested for your Import Control Tower account.',
      '',
      'This link works once and expires in 60 minutes:',
      link,
      '',
      'If you did not ask for this, you can ignore this email. Your password will not change.',
    ].join('\n'),
  })
}
