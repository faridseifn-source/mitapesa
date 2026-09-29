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

// Renders the admin statement endpoint's combined shape — a financial
// (card) section, a PFM section, or both, each in its own clearly
// labeled block rather than merged into one table. A PFM entry has no
// running balance to show (see computePfmStatement's own doc comment
// for why), so its table omits that column entirely rather than leaving
// it blank for every row.
function combinedStatementToCsv({ source, from, to, financial, pfm }) {
  let out = "";
  out += csvRow(["MitaPesa Statement"]);
  out += csvRow(["Source", source]);
  out += csvRow(["Period", `${new Date(from).toISOString().slice(0, 10)} to ${new Date(to).toISOString().slice(0, 10)}`]);
  out += csvRow([]);

  if (financial) {
    out += csvRow(["Financial (card/wallet)"]);
    out += csvRow(["Reference", financial.reference]);
    out += csvRow(["Opening balance", financial.openingBalance]);
    out += csvRow(["Closing balance", financial.closingBalance]);
    out += csvRow(["Total credits", financial.totalCredits]);
    out += csvRow(["Total debits", financial.totalDebits]);
    out += csvRow([]);
    out += csvRow(["Date", "Description", "Type", "Amount (TZS)", "Balance after"]);
    for (const entry of financial.entries) {
      out += csvRow([new Date(entry.date).toISOString().slice(0, 10), entry.label, entry.type, entry.amount, entry.balanceAfter]);
    }
    out += csvRow([]);
  }

  if (pfm) {
    out += csvRow(["PFM (logged expenses)"]);
    out += csvRow(["Reference", pfm.reference]);
    out += csvRow(["Total income", pfm.totalIncome]);
    out += csvRow(["Total spent", pfm.totalSpent]);
    out += csvRow([]);
    out += csvRow(["Date", "Merchant", "Category", "Amount (TZS)"]);
    for (const entry of pfm.entries) {
      out += csvRow([new Date(entry.date).toISOString().slice(0, 10), entry.label, entry.type, entry.amount]);
    }
  }

  return out;
}

function sendCsv(res, filename, csvContent) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csvContent);
}

module.exports = { csvRow, statementToCsv, combinedStatementToCsv, sendCsv };
