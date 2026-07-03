/**
 * Email delivery, provider-agnostic.
 *
 * Right now no provider is configured, so `sendVerificationCode` reports
 * `delivered: false` and the caller surfaces the code in dev instead of
 * pretending an email went out (same honesty rule as the Google button and
 * the no-payment pricing page).
 *
 * When you're ready to send for real, AWS SES is the intended provider (the
 * org default). Wire it in `send()` below behind the env check — the rest of
 * the app already treats delivery as best-effort, so nothing else changes.
 */

export function isEmailConfigured(): boolean {
  // Flip to a real check (e.g. SES creds present) when a provider is wired.
  // return Boolean(process.env.AWS_REGION && process.env.EMAIL_FROM);
  return false;
}

export type SendResult = {
  /** true once a real provider actually accepted the message */
  delivered: boolean;
};

export async function sendVerificationCode(
  email: string,
  code: string,
): Promise<SendResult> {
  if (!isEmailConfigured()) {
    // Dev mode: no provider. The route returns the code to the client and
    // logs it, so the flow is fully testable without sending anything.
    console.log(`[mailer:dev] verification code for ${email}: ${code}`);
    return { delivered: false };
  }

  // ---- provider send goes here (AWS SES) ----
  // const ses = new SESv2Client({ region: process.env.AWS_REGION });
  // await ses.send(new SendEmailCommand({ ...verification template... }));
  // For now, treat an unconfigured-but-claimed-configured state as not sent.
  return { delivered: false };
}
