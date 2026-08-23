import "server-only";

import PDFDocument from "pdfkit";
import type { TimeClockReport } from "@/lib/timeClockTypes";
import { entryHours } from "@/lib/timeClockDb";

function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function formatDate(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

function formatDateTime(iso: string | null, timezone: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function drawTable(
  doc: InstanceType<typeof PDFDocument>,
  headers: string[],
  rows: string[][],
  opts?: { columnWidths?: number[] }
) {
  const startX = doc.page.margins.left;
  const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colCount = headers.length;
  const widths =
    opts?.columnWidths ||
    Array.from({ length: colCount }, () => tableWidth / colCount);
  const rowHeight = 20;
  const cellPad = 4;

  function ensureSpace(needed: number) {
    if (doc.y + needed > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }
  }

  function drawRow(cells: string[], bold = false) {
    ensureSpace(rowHeight + 4);
    const y = doc.y;
    let x = startX;
    if (bold) doc.font("Helvetica-Bold");
    else doc.font("Helvetica");
    doc.fontSize(9);
    for (let i = 0; i < cells.length; i++) {
      doc.text(cells[i] || "", x + cellPad, y + cellPad, {
        width: widths[i] - cellPad * 2,
        lineBreak: false,
        ellipsis: true,
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
  for (const row of rows) {
    drawRow(row);
  }
  doc.moveDown(0.5);
}

export function buildTimeClockReportPdf(report: TimeClockReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "LETTER" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const tz = report.timezone;
    const fromLabel = formatDate(report.from, tz);
    const toLabel = formatDate(report.to, tz);

    doc.font("Helvetica-Bold").fontSize(20).fillColor("#142433");
    doc.text("Time Clock Report", { align: "left" });
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(11).fillColor("#3d5166");
    doc.text(`Period: ${fromLabel} – ${toLabel}`);
    doc.text(`Timezone: ${tz}`);
    doc.text(`Generated: ${formatDateTime(new Date().toISOString(), tz)}`);
    doc.moveDown(0.8);

    doc.font("Helvetica-Bold").fontSize(14).fillColor("#142433");
    doc.text(`Total hours: ${formatHours(report.total_hours)}`);
    doc.moveDown(0.8);

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

    if (report.by_user?.length) {
      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(14).fillColor("#142433");
      doc.text("By team member");
      doc.moveDown(0.5);

      for (const user of report.by_user) {
        doc.font("Helvetica-Bold").fontSize(11).fillColor("#0c6b6b");
        doc.text(`${user.user_name} (${user.user_email})`);
        doc.font("Helvetica").fontSize(10).fillColor("#3d5166");
        doc.text(`Total: ${formatHours(user.total_hours)}`);
        doc.moveDown(0.2);
        drawTable(
          doc,
          ["Week start", "Week end", "Entries", "Hours"],
          user.weekly_breakdown.map((row) => [
            row.week_start,
            row.week_end,
            String(row.entry_count),
            formatHours(row.hours),
          ]),
          { columnWidths: [120, 120, 80, 80] }
        );
        doc.moveDown(0.5);
      }
    }

    if (report.entries.length) {
      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#142433");
      doc.text("Time entries");
      doc.moveDown(0.3);
      drawTable(
        doc,
        ["Name", "Clock in", "Clock out", "Hours", "Notes"],
        report.entries.map((entry) => [
          entry.user_name || entry.user_email,
          formatDateTime(entry.clock_in, tz),
          entry.clock_out ? formatDateTime(entry.clock_out, tz) : "Open",
          formatHours(entryHours(entry)),
          entry.notes || "",
        ]),
        { columnWidths: [90, 95, 95, 55, 125] }
      );
    }

    doc.end();
  });
}
