import nodemailer from 'nodemailer';
import type { Config } from '../config';

export type Mailer = (to: string, subject: string, text: string) => Promise<void>;

/** SMTP when SMTP_URL is set, otherwise logs the message. Plug in any provider that speaks SMTP. */
export function createMailer(cfg: Config): Mailer {
  if (!cfg.SMTP_URL) return async (to, subject) => { if (cfg.NODE_ENV !== 'test') console.log(`[mail:dry-run] to=${to} subject="${subject}"`); };
  const t = nodemailer.createTransport(cfg.SMTP_URL);
  return async (to, subject, text) => { await t.sendMail({ from: cfg.MAIL_FROM, to, subject, text }); };
}
