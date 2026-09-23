import { useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { adminApi } from "../api.js";
import { Card, Button, Input, Spinner, Pagination, EmptyState } from "../components/ui.jsx";

export default function BroadcastPage() {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [url, setUrl] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sentNotice, setSentNotice] = useState(null);

  const [history, setHistory] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const pageSize = 20;

  const loadHistory = () => {
    setLoading(true);
    adminApi.broadcasts.list(page, pageSize).then((r) => { setHistory(r.broadcasts); setTotal(r.total); }).finally(() => setLoading(false));
  };
  useEffect(() => { loadHistory(); }, [page]);

  const send = async () => {
    setSending(true); setError("");
    try {
      const { broadcast } = await adminApi.broadcasts.send(title.trim(), message.trim(), url.trim() || undefined);
      setSentNotice(broadcast);
      setTitle(""); setMessage(""); setUrl(""); setConfirming(false);
      setPage(1); loadHistory();
    } catch (err) {
      setError(err.message || "Couldn't send the broadcast.");
    } finally {
      setSending(false);
    }
  };

  const canSend = title.trim().length >= 3 && message.trim().length >= 3;

  return (
    <div>
      <h1 className="text-[22px] font-bold font-display text-ink mb-1">Broadcast</h1>
      <p className="text-[13.5px] text-inkFaint mb-6">Send an announcement to every customer at once — in-app notification and push, immediately. This can't be un-sent.</p>

      <Card className="p-5 mb-8 max-w-xl">
        {sentNotice && (
          <div className="mb-4 p-3 rounded-lg bg-accentSoft text-accent text-[13px] font-semibold">
            Sent to {sentNotice.recipientCount} customer{sentNotice.recipientCount === 1 ? "" : "s"}.
          </div>
        )}
        {!confirming ? (
          <>
            <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Scheduled maintenance tonight" className="mb-3" maxLength={100} />
            <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Message</label>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} maxLength={500} className="w-full px-3.5 py-2.5 rounded-lg border border-border bg-white text-[13.5px] text-ink mb-3 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent" placeholder="What do customers need to know?" />
            <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Link (optional)</label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="/support" className="mb-4" />
            {error && <p className="text-[12.5px] text-danger mb-3">{error}</p>}
            <Button variant="accent" disabled={!canSend} onClick={() => setConfirming(true)} className="flex items-center gap-2"><Megaphone size={14} /> Review & send</Button>
          </>
        ) : (
          <>
            <p className="text-[12px] font-semibold text-inkFaint uppercase tracking-wide mb-3">Confirm before sending</p>
            <div className="p-4 rounded-lg bg-bgSoft mb-4">
              <p className="text-[14px] font-bold text-ink mb-1">{title}</p>
              <p className="text-[13px] text-inkSoft whitespace-pre-wrap">{message}</p>
            </div>
            <p className="text-[12.5px] text-danger mb-4">This sends immediately to every customer and cannot be recalled. Double-check the wording above.</p>
            {error && <p className="text-[12.5px] text-danger mb-3">{error}</p>}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={sending}>Back to edit</Button>
              <Button variant="danger" onClick={send} disabled={sending} className="flex-1">{sending ? "Sending…" : "Send to all customers"}</Button>
            </div>
          </>
        )}
      </Card>

      <p className="text-[15px] font-bold font-display text-ink mb-3">History</p>
      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border bg-bgSoft/60">
                <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Title</th>
                <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Message</th>
                <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Recipients</th>
                <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Sent</th>
              </tr>
            </thead>
            <tbody>
              {history.map((b) => (
                <tr key={b.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3 text-[13px] font-semibold text-ink">{b.title}</td>
                  <td className="px-5 py-3 text-[12.5px] text-inkSoft max-w-xs truncate">{b.message}</td>
                  <td className="px-5 py-3 text-[12.5px] text-inkFaint">{b.recipientCount}</td>
                  <td className="px-5 py-3 text-[12.5px] text-inkFaint">{new Date(b.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {history.length === 0 && <EmptyState title="No broadcasts sent yet" sub="Your first announcement will show up here." />}
        </Card>
      )}
      {!loading && total > 0 && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />}
    </div>
  );
}
