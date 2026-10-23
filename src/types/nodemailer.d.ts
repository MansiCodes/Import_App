declare module 'nodemailer' {
  interface TransportOptions {
    host?: string
    port?: number
    secure?: boolean
    auth?: { user: string; pass: string }
  }

  interface SendMailOptions {
    from: string
    to: string
    subject: string
    text: string
  }

  interface Transporter {
    sendMail(options: SendMailOptions): Promise<unknown>
  }

  function createTransport(options: TransportOptions): Transporter

  export default { createTransport }
}
