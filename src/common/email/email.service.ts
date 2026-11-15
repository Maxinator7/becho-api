import { env } from '../../config/env.js';

export interface EmailMessage {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Sends transactional email.
 * - With BREVO_API_KEY: Brevo's HTTPS API (Render's free plan blocks SMTP ports, so no SMTP).
 * - Without it (dev/tests): logs the message instead of sending.
 * Returns false instead of throwing, so a mail outage never breaks sign-up; callers decide what to tell the user.
 */
export async function sendEmail(message: EmailMessage): Promise<boolean> {
  if (!env.BREVO_API_KEY) {
    if (env.NODE_ENV !== 'test') console.log(`[email:dev] to=${message.to} subject="${message.subject}"\n${message.text}`);
    return true;
  }
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: env.EMAIL_FROM, name: env.EMAIL_FROM_NAME },
        to: [{ email: message.to, ...(message.toName ? { name: message.toName } : {}) }],
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[email] Brevo rejected message (${res.status}): ${(await res.text()).slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[email] send failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function codeEmail(heading: string, intro: string, code: string, footer: string) {
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f7fb;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;border:1px solid #e2e8f0">
    <div style="font-size:20px;font-weight:800;color:#4f46e5;margin-bottom:16px">BECHO</div>
    <h1 style="font-size:18px;margin:0 0 8px">${escape(heading)}</h1>
    <p style="margin:0 0 20px;color:#475569;line-height:1.5">${escape(intro)}</p>
    <div style="font-size:32px;letter-spacing:8px;font-weight:800;text-align:center;padding:16px;background:#eef2ff;border-radius:10px;color:#312e81">${code}</div>
    <p style="margin:20px 0 0;color:#64748b;font-size:13px;line-height:1.5">${escape(footer)}</p>
  </div></body></html>`;
  const text = `${heading}\n\n${intro}\n\nCode: ${code}\n\n${footer}`;
  return { html, text };
}

export function verificationCodeEmail(to: string, name: string, code: string): EmailMessage {
  return {
    to,
    toName: name,
    subject: `${code} is your Becho verification code`,
    ...codeEmail(
      'Verify your email',
      `Hi ${name}, enter this code in Becho to verify your account. It expires in 15 minutes.`,
      code,
      "If you didn't create a Becho account, you can ignore this email."
    ),
  };
}

export function passwordResetEmail(to: string, name: string, code: string): EmailMessage {
  return {
    to,
    toName: name,
    subject: `${code} is your Becho password reset code`,
    ...codeEmail(
      'Reset your password',
      `Hi ${name}, use this code to set a new password. It expires in 15 minutes.`,
      code,
      "If you didn't ask to reset your password, ignore this email — your password stays the same. Never share this code with anyone, including Becho staff."
    ),
  };
}

/** a***@gmail.com — shows where a code went without revealing the full address. */
export function maskEmail(email: string) {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(1, Math.min(local.length - 1, 5)))}@${domain}`;
}
