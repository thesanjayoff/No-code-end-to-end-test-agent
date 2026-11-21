export interface NotifyOptions {
  webhookUrl?: string;
  email?: string;
  subject: string;
  message: string;
}

/**
 * Sends a short, plain-English failure summary via webhook and/or email.
 * Email requires TESTWISE_SMTP_WEBHOOK (a webhook-to-email relay URL, or
 * your own mail API endpoint) since Testwise ships no SMTP client -- if
 * it's not configured, the email leg is skipped and logged, not silently
 * dropped.
 */
export async function notify(opts: NotifyOptions): Promise<void> {
  if (opts.webhookUrl) {
    try {
      await fetch(opts.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject: opts.subject, message: opts.message }),
      });
    } catch (err) {
      console.error(`Webhook notification to ${opts.webhookUrl} failed:`, err);
    }
  }

  if (opts.email) {
    const relay = process.env.TESTWISE_SMTP_WEBHOOK;
    if (!relay) {
      console.log(`[notify] Email configured for ${opts.email} but TESTWISE_SMTP_WEBHOOK is not set -- skipping. Subject: ${opts.subject}`);
      return;
    }
    try {
      await fetch(relay, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: opts.email, subject: opts.subject, message: opts.message }),
      });
    } catch (err) {
      console.error(`Email relay ${relay} failed:`, err);
    }
  }
}
