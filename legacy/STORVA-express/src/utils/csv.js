'use strict';
// CSV for owner exports (Modules 11, 14). RFC 4180 quoting, a UTF-8 BOM so Excel shows ₹ and Malayalam correctly, and protection
// against spreadsheet formula injection: a cell starting with = + - @ (or tab/CR) is prefixed with ' so it is shown as text.
function cell(v) {
  if (v == null) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const toCsv = (header, rows) => '\uFEFF' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
function sendCsv(res, filename, header, rows) {
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename.replace(/[^a-z0-9._-]/gi, '_')}"`, 'Cache-Control': 'no-store' });
  res.send(toCsv(header, rows));
}
module.exports = { cell, toCsv, sendCsv };
