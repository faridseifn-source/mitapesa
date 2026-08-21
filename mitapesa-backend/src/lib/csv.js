// Minimal, dependency-free CSV writer — statements are simple tabular data,
// not worth pulling in a library for. Handles the one thing that actually
// matters: quoting fields that contain a comma, quote, or newline.
function csvEscape(value) {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(fields) {
  return fields.map(csvEscape).join(",") + "\r\n";
}

// Renders a computeStatement() result as a CSV string.
function statementToCsv(statement) {
  let out = "";
  out += csvRow(["MitaPesa Statement"]);
  out += csvRow(["Reference", statement.reference]);
  out += csvRow(["Period", `${new Date(statement.from).toISOString().slice(0, 10)} to ${new Date(statement.to).toISOString().slice(0, 10)}`]);
  out += csvRow(["Opening balance", statement.openingBalance]);
  out += csvRow(["Closing balance", statement.closingBalance]);
  out += csvRow(["Total credits", statement.totalCredits]);
  out += csvRow(["Total debits", statement.totalDebits]);
  out += csvRow([]);
  out += csvRow(["Date", "Description", "Type", "Amount (TZS)", "Balance after"]);
  for (const entry of statement.entries) {
    out += csvRow([new Date(entry.date).toISOString().slice(0, 10), entry.label, entry.type, entry.amount, entry.balanceAfter]);
  }
  return out;
}

function sendCsv(res, filename, csvContent) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csvContent);
}

module.exports = { csvRow, statementToCsv, sendCsv };
