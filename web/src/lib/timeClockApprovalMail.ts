import "server-only";

import { htmlEmail, sendEmail, timeClockEmailEnabled } from "@/lib/mailer";
import { formatDateTime, formatHours } from "@/lib/timeClockFormat";
import { listSupervisorsForUser } from "@/lib/timeClockTeamsDb";
import {
  TIME_OFF_KIND_LABELS,
  type TimeOffEntry,
  type TimeEntryEditRequest,
} from "@/lib/timeClockTypes";

function appUrl(): string {
  return (
    process.env.NEXTAUTH_URL ||
    process.env.APP_URL ||
    "https://tool.releviumpain.com"
  ).replace(/\/$/, "");
}

async function recipientsForEmployee(
  employeeEmail: string
): Promise<Array<{ email: string; name: string }>> {
  const employee = employeeEmail.toLowerCase();
  return (await listSupervisorsForUser(employee)).filter(
    (person) => person.email !== employee
  );
}

async function sendToRecipients(input: {
  employeeEmail: string;
  subject: string;
  heading: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
}): Promise<void> {
  if (!timeClockEmailEnabled()) return;
  const recipients = await recipientsForEmployee(input.employeeEmail);
  if (!recipients.length) {
    console.warn(
      "No supervisor to email for time clock approval",
      input.employeeEmail
    );
    return;
  }
  const text = `${input.heading}\n\n${input.body}\n\n${input.ctaLabel}: ${input.ctaUrl}`;
  const html = htmlEmail({
    heading: input.heading,
    body: input.body,
    ctaLabel: input.ctaLabel,
    ctaUrl: input.ctaUrl,
  });
  await Promise.all(
    recipients.map((person) =>
      sendEmail({
        to: person.email,
        subject: input.subject,
        text,
        html,
      })
    )
  );
}

export async function notifyTimeOffPending(entry: TimeOffEntry): Promise<void> {
  try {
    const name = entry.user_name || entry.user_email;
    const kind = TIME_OFF_KIND_LABELS[entry.kind] || entry.kind;
    const url = `${appUrl()}/time-clock/approvals`;
    await sendToRecipients({
      employeeEmail: entry.user_email,
      subject: `Time off request: ${name}`,
      heading: "New time-off request",
      body:
        `${name} requested ${formatHours(entry.hours)} of ${kind} on ${entry.entry_date}` +
        (entry.notes ? ` (${entry.notes}).` : ".") +
        " Open Approvals to approve or deny it.",
      ctaLabel: "Open Approvals",
      ctaUrl: url,
    });
  } catch (err) {
    console.error("Time off approval email failed", err);
  }
}

export async function notifyPunchEditPending(
  request: TimeEntryEditRequest,
  opts: { employeeName?: string; timezone?: string }
): Promise<void> {
  try {
    const name = opts.employeeName || request.requester_name || request.requested_by;
    const url = `${appUrl()}/time-clock/approvals`;
    const tz = opts.timezone;
    const proposed = `${formatDateTime(request.proposed_clock_in, tz)} – ${formatDateTime(
      request.proposed_clock_out,
      tz
    )}`;
    await sendToRecipients({
      employeeEmail: request.requested_by,
      subject: `Punch edit request: ${name}`,
      heading: "New punch edit request",
      body:
        `${name} requested a punch change to ${proposed}` +
        (request.reason ? ` (${request.reason}).` : ".") +
        " Open Approvals to approve or reject it.",
      ctaLabel: "Open Approvals",
      ctaUrl: url,
    });
  } catch (err) {
    console.error("Punch edit approval email failed", err);
  }
}
