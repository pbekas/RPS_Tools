import "server-only";

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

function sesFromEmail(): string {
  return (process.env.SES_FROM_EMAIL || "").trim();
}

export function timeClockEmailEnabled(): boolean {
  const flag = (process.env.TIME_CLOCK_EMAIL_ENABLED || "1").trim().toLowerCase();
  const on = flag === "1" || flag === "true" || flag === "yes" || flag === "on";
  return on && Boolean(sesFromEmail());
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function htmlEmail(input: {
  heading: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
}): string {
  const heading = escapeHtml(input.heading);
  const body = escapeHtml(input.body);
  const label = escapeHtml(input.ctaLabel);
  const url = escapeHtml(input.ctaUrl);
  return (
    `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;` +
    `line-height:1.5;color:#1a1a1a">` +
    `<p><strong>${heading}</strong></p>` +
    `<p>${body}</p>` +
    `<p><a href="${url}">${label}</a></p>` +
    `<p style="color:#666;font-size:12px">` +
    `This is an automated message from Relevium Tools - Time Clock.` +
    `</p></body></html>`
  );
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<boolean> {
  const source = sesFromEmail();
  const recipient = (input.to || "").trim();
  if (!source) {
    console.warn("SES_FROM_EMAIL not set — skip email");
    return false;
  }
  if (!recipient || !recipient.includes("@")) {
    console.warn("Skip email with invalid recipient", input.to);
    return false;
  }

  try {
    const client = new SESClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
    await client.send(
      new SendEmailCommand({
        Source: source,
        Destination: { ToAddresses: [recipient] },
        Message: {
          Subject: { Data: input.subject, Charset: "UTF-8" },
          Body: {
            Text: { Data: input.text, Charset: "UTF-8" },
            ...(input.html
              ? { Html: { Data: input.html, Charset: "UTF-8" } }
              : {}),
          },
        },
      })
    );
    return true;
  } catch (err) {
    console.error("SES send failed", recipient, err);
    return false;
  }
}
