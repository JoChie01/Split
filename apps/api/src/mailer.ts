/**
 * mailer.ts
 *
 * WHAT: Sends the login email. The API doesn't care which email service is used,
 *       only that it can call a function with (to, subject, text).
 * SERVICE: Resend (https://resend.com), called directly with fetch so no extra package is needed.
 */
export type Mailer = (to: string, subject: string, text: string) => Promise<void>;

export function resendMailer(apiKey: string, from: string): Mailer {
  return async (to, subject, text) => {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    // Don't include the response body: it can echo the email address.
    if (!res.ok) throw new Error(`Email service returned ${res.status}`);
  };
}

/** Used when no email service is set up. Login fails loudly instead of silently. */
export const unconfiguredMailer: Mailer = async () => {
  throw new Error("Email is not configured: set RESEND_API_KEY in apps/api/.env");
};
