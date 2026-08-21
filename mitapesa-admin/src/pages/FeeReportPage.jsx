import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { adminApi } from "../api.js";
import { Card, StatCard, Input, Button, Spinner, EmptyState, fmtTZS } from "../components/ui.jsx";

function firstOfMonth() {
  const d = new Date(); d.setDate(1);
  return d.toISOString().slice(0, 10);
}

export default function FeeReportPage() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloadingSummary, setDownloadingSummary] = useState(false);
  const [downloadingDetail, setDownloadingDetail] = useState(false);

  const downloadSummaryCsv = async () => {
    setDownloadingSummary(true); setError("");
    try { await adminApi.fees.downloadReportCsv(from, to); }
    catch (err) { setError(err.message || "Couldn't download the report."); }
    finally { setDownloadingSummary(false); }
  };

  const downloadDetailCsv = async () => {
    setDownloadingDetail(true); setError("");
    try { await adminApi.fees.downloadReportDetailCsv(from, to); }
    catch (err) { setError(err.message || "Couldn't download the detailed transaction export."); }
    finally { setDownloadingDetail(false); }
  };

  const load = () => {
    setLoading(true); setError("");
    adminApi.fees.report(from, to).then(setReport).catch((err) => setError(err.message)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  return (
    <div>
      <h1 className="text-[22px] font-bold font-display text-ink mb-1">Fee revenue</h1>
      <p className="text-[13.5px] text-inkFaint mb-6">Revenue collected through the Dynamic Fee Engine, by transaction type.</p>

      <div className="flex items-end gap-2 mb-2">
        <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">From</label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">To</label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <Button variant="accent" onClick={load}>Apply</Button>
        <Button variant="ghost" onClick={downloadSummaryCsv} disabled={downloadingSummary} className="flex items-center gap-1.5"><Download size={14} /> {downloadingSummary ? "Preparing…" : "Summary CSV"}</Button>
        <Button variant="ghost" onClick={downloadDetailCsv} disabled={downloadingDetail} className="flex items-center gap-1.5"><Download size={14} /> {downloadingDetail ? "Preparing…" : "Detailed transaction CSV"}</Button>
      </div>
      <p className="text-[11.5px] text-inkFaint mb-4">Detailed export includes every individual fee record with the underlying transaction reference, which rule/bundle/exemption applied, and the disclosure shown to the customer — built for manual reconciliation validation, not just a dashboard glance.</p>

      {error && <p className="text-[13px] text-danger mb-4">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : !report ? null : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
            <StatCard label="MitaPesa fee revenue" value={fmtTZS(report.totalMitaPesaFee)} tone="accent" />
            <StatCard label="Partner fees disclosed" value={fmtTZS(report.totalPartnerFee)} />
            <StatCard label="Tax collected" value={fmtTZS(report.totalTax)} />
            <StatCard label="Reversed" value={fmtTZS(report.totalReversed)} tone={report.totalReversed > 0 ? "danger" : "ink"} />
            <StatCard label="Bundle sales" value={fmtTZS(report.bundleSalesRevenue)} tone="gold" hint={`${report.bundleSalesCount} sold`} />
          </div>

          <p className="text-[15px] font-bold font-display text-ink mb-3">By transaction type</p>
          <Card className="overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border bg-bgSoft/60">
                  <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Type</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Transactions</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">MitaPesa fee</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Partner fee</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Reversed</th>
                </tr>
              </thead>
              <tbody>
                {report.byTransactionType.map((r) => (
                  <tr key={r.transactionTypeCode} className="border-b border-border last:border-0">
                    <td className="px-5 py-3.5 text-[13px] font-semibold text-ink font-mono">{r.transactionTypeCode}</td>
                    <td className="px-5 py-3.5 text-[12.5px] text-inkSoft">{r.count}</td>
                    <td className="px-5 py-3.5 text-[12.5px] text-inkSoft font-mono">{fmtTZS(r.mitaPesaFee)}</td>
                    <td className="px-5 py-3.5 text-[12.5px] text-inkSoft font-mono">{fmtTZS(r.partnerFee)}</td>
                    <td className="px-5 py-3.5 text-[12.5px] text-inkSoft font-mono">{fmtTZS(r.reversed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {report.byTransactionType.length === 0 && <EmptyState title="No fee revenue in this period" sub="Try widening the date range." />}
          </Card>
        </>
      )}
    </div>
  );
}
