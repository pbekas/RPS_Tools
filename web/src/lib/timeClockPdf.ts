import "server-only";

import PDFDocument from "pdfkit";
import type { TimeClockReport, TimeClockReportApproval } from "@/lib/timeClockTypes";
import { entryHours } from "@/lib/timeClockDb";

function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function formatHoursDecimal(hours: number): string {
  return hours.toFixed(2);
}

function formatDate(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

function formatDateYmd(ymd: string, timezone: string): string {
  return formatDate(`${ymd}T12:00:00.000Z`, timezone);
}

function formatDateTime(iso: string | null, timezone: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function approvalLabel(approval?: TimeClockReportApproval): string {
  if (!approval) return "Not reviewed";
  if (approval.status === "approved") return "Approved";
  if (approval.status === "submitted") return "Submitted — pending approval";
  if (approval.status === "rejected") return "Rejected";
  if (approval.status === "open") return "Not submitted";
  return "—";
}

function drawApprovalStamp(
  doc: InstanceType<typeof PDFDocument>,
  x: number,
  y: number,
  width: number,
  timezone: string,
  approval?: TimeClockReportApproval
) {
  const height = 52;
  if (!approval || approval.status !== "approved") {
    doc.font("Helvetica").fontSize(8).fillColor("#8a4b4b");
    doc.text(approvalLabel(approval), x, y + 8, { width, align: "center" });
    return height;
  }

  doc
    .roundedRect(x, y, width, height, 4)
    .lineWidth(1.5)
    .strokeColor("#0c6b6b")
    .stroke();
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#0c6b6b");
  doc.text("APPROVED", x, y + 8, { width, align: "center" });
  doc.font("Helvetica").fontSize(8).fillColor("#142433");
  doc.text(approval.reviewed_by_name || "Manager", x, y + 22, {
    width,
    align: "center",
  });
  doc.text(
    approval.reviewed_at ? formatDate(approval.reviewed_at, timezone) : "",
    x,
    y + 34,
    { width, align: "center" }
  );
  return height;
}

function drawTable(
  doc: InstanceType<typeof PDFDocument>,
  headers: string[],
  rows: string[][],
  opts?: { columnWidths?: number[]; rowHeights?: number[] }
) {
  const startX = doc.page.margins.left;
  const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colCount = headers.length;
  const widths =
    opts?.columnWidths ||
    Array.from({ length: colCount }, () => tableWidth / colCount);
  const defaultRowHeight = 20;
  const cellPad = 4;

  function ensureSpace(needed: number) {
    if (doc.y + needed > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }
  }

  function drawRow(cells: string[], bold = false, rowHeight = defaultRowHeight) {
    ensureSpace(rowHeight + 4);
    const y = doc.y;
    let x = startX;
    if (bold) doc.font("Helvetica-Bold");
    else doc.font("Helvetica");
    doc.fontSize(9);
    for (let i = 0; i < cells.length; i++) {
      doc.text(cells[i] || "", x + cellPad, y + cellPad, {
        width: widths[i] - cellPad * 2,
        lineBreak: true,
      });
      x += widths[i];
    }
    doc
      .moveTo(startX, y + rowHeight)
      .lineTo(startX + tableWidth, y + rowHeight)
      .strokeColor("#d3dde6")
      .stroke();
    doc.y = y + rowHeight;
  }

  drawRow(headers, true);
  rows.forEach((row, index) => {
    drawRow(row, false, opts?.rowHeights?.[index] ?? defaultRowHeight);
  });
  doc.moveDown(0.5);
}

function drawPayPeriodSummary(
  doc: InstanceType<typeof PDFDocument>,
  report: TimeClockReport
) {
  const tz = report.timezone;
  const period = report.pay_period;
  const periodLabel = period
    ? `${formatDateYmd(period.period_start, tz)} – ${formatDateYmd(period.period_end, tz)}`
    : `${formatDate(report.from, tz)} – ${formatDate(report.to, tz)}`;
  const periodNumber = period ? `Pay Period #${period.period_number}` : "Custom period";

  doc.font("Helvetica-Bold").fontSize(20).fillColor("#142433");
  doc.text("Pay Period Timesheet Report", { align: "left" });
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(11).fillColor("#3d5166");
  doc.text(periodNumber);
  doc.text(`Dates: ${periodLabel}`);
  doc.text(`Timezone: ${tz}`);
  doc.text(`Generated: ${formatDateTime(new Date().toISOString(), tz)}`);
  doc.moveDown(0.8);

  const users = report.by_user || [];
  if (!users.length && report.entries.length) {
    const email = report.entries[0]?.user_email || "";
    users.push({
      user_email: email,
      user_name: report.entries[0]?.user_name || email,
      total_hours: report.total_hours,
      weekly_breakdown: report.weekly_breakdown,
      entries: report.entries,
    });
  }

  doc.font("Helvetica-Bold").fontSize(12).fillColor("#142433");
  doc.text("Employee summary");
  doc.moveDown(0.4);

  const startX = doc.page.margins.left;
  const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const nameWidth = 150;
  const dateWidth = 145;
  const hoursWidth = 70;
  const stampWidth = tableWidth - nameWidth - dateWidth - hoursWidth;
  const headerY = doc.y;

  doc.font("Helvetica-Bold").fontSize(9).fillColor("#142433");
  doc.text("Employee", startX + 4, headerY);
  doc.text("Pay period", startX + nameWidth + 4, headerY);
  doc.text("Total hours", startX + nameWidth + dateWidth + 4, headerY);
  doc.text("Approval", startX + nameWidth + dateWidth + hoursWidth + 4, headerY);
  doc
    .moveTo(startX, headerY + 16)
    .lineTo(startX + tableWidth, headerY + 16)
    .strokeColor("#d3dde6")
    .stroke();
  doc.y = headerY + 20;

  for (const user of users) {
    const rowHeight = 58;
    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }
    const y = doc.y;
    doc.font("Helvetica").fontSize(9).fillColor("#142433");
    doc.text(user.user_name, startX + 4, y + 6, {
      width: nameWidth - 8,
    });
    doc.font("Helvetica").fontSize(8).fillColor("#3d5166");
    doc.text(user.user_email, startX + 4, y + 20, {
      width: nameWidth - 8,
    });
    doc.font("Helvetica").fontSize(9).fillColor("#142433");
    doc.text(periodLabel, startX + nameWidth + 4, y + 10, {
      width: dateWidth - 8,
    });
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#0c6b6b");
    doc.text(formatHours(user.total_hours), startX + nameWidth + dateWidth + 4, y + 10, {
      width: hoursWidth - 8,
    });
    doc.text(
      `(${formatHoursDecimal(user.total_hours)} hrs)`,
      startX + nameWidth + dateWidth + 4,
      y + 24,
      { width: hoursWidth - 8 }
    );
    drawApprovalStamp(
      doc,
      startX + nameWidth + dateWidth + hoursWidth + 2,
      y + 2,
      stampWidth - 4,
      tz,
      user.approval
    );
    doc
      .moveTo(startX, y + rowHeight)
      .lineTo(startX + tableWidth, y + rowHeight)
      .strokeColor("#d3dde6")
      .stroke();
    doc.y = y + rowHeight;
  }

  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#142433");
  doc.text(`Pay period total: ${formatHours(report.total_hours)} (${formatHoursDecimal(report.total_hours)} hours)`);
}

export function buildTimeClockReportPdf(report: TimeClockReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "LETTER" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const tz = report.timezone;
    drawPayPeriodSummary(doc, report);

    if (report.by_user?.length) {
      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#142433");
      doc.text("Weekly breakdown by employee");
      doc.moveDown(0.5);
      for (const user of report.by_user) {
        doc.font("Helvetica-Bold").fontSize(11).fillColor("#0c6b6b");
        doc.text(`${user.user_name} — ${formatHours(user.total_hours)}`);
        doc.moveDown(0.2);
        drawTable(
          doc,
          ["Week start", "Week end", "Entries", "Hours", "Timesheet"],
          user.weekly_breakdown.map((row) => {
            const weekApproval = user.approval?.weeks.find(
              (w) => w.week_start === row.week_start
            );
            return [
              row.week_start,
              row.week_end,
              String(row.entry_count),
              formatHours(row.hours),
              weekApproval?.status || "open",
            ];
          }),
          { columnWidths: [85, 85, 55, 55, 90] }
        );
        doc.moveDown(0.3);
      }
    } else if (report.weekly_breakdown.length) {
      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(12).text("Weekly breakdown");
      doc.moveDown(0.3);
      drawTable(
        doc,
        ["Week start", "Week end", "Entries", "Hours"],
        report.weekly_breakdown.map((row) => [
          row.week_start,
          row.week_end,
          String(row.entry_count),
          formatHours(row.hours),
        ]),
        { columnWidths: [120, 120, 80, 80] }
      );
    }

    if (report.entries.length) {
      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#142433");
      doc.text("Time entry detail");
      doc.moveDown(0.3);
      drawTable(
        doc,
        ["Employee", "Clock in", "Clock out", "Hours", "Notes"],
        report.entries.map((entry) => [
          entry.user_name || entry.user_email,
          formatDateTime(entry.clock_in, tz),
          entry.clock_out ? formatDateTime(entry.clock_out, tz) : "Open",
          formatHours(entryHours(entry)),
          entry.notes || "",
        ]),
        { columnWidths: [95, 95, 95, 55, 120] }
      );
    }

    doc.end();
  });
}
