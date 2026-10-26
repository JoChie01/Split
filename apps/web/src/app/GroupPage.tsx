/**
 * GroupPage.tsx
 *
 * WHAT: One group, with two tabs. Bills is a placeholder for now.
 *       Payments shows what needs your action first (with the badge count), then the history.
 */
import { useEffect, useRef, useState } from "react";
import { formatPeso } from "@split/core";
import { api, attachReceipt, ApiError } from "./api";
import { splitNotices } from "./notices";
import type { Group, Payment } from "./types";

type Tab = "bills" | "payments";

export function GroupPage({ groupId, onBack }: { groupId: string; onBack: () => void }) {
  const [group, setGroup] = useState<Group | null>(null);
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [tab, setTab] = useState<Tab>("payments");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const receiptFor = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const [g, p] = await Promise.all([
        api<Group>("GET", `/groups/${groupId}`),
        api<Payment[]>("GET", `/groups/${groupId}/payments`),
      ]);
      setGroup(g);
      setPayments(p);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this group.");
    }
  }

  useEffect(() => {
    load();
    // load() reads groupId; reload when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  function flash(text: string) {
    setToast(text);
    window.setTimeout(() => setToast(null), 2800);
  }

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      flash(label);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (error && !group) return <main className="app-page"><p className="app-error" role="alert">{error}</p></main>;
  if (!group || !payments) return <main className="app-page"><p>Loading...</p></main>;

  const me = group.members.find((m) => m.isYou);
  if (!me) return <main className="app-page"><p className="app-error">You're not a member of this group.</p></main>;

  const names = new Map(group.members.map((m) => [m.id, m.displayName]));
  const name = (id: string) => names.get(id) ?? "Someone";
  const { needs, earlier } = splitNotices(payments, me.id);

  function onFileChosen(file: File | undefined) {
    const paymentId = receiptFor.current;
    receiptFor.current = null;
    if (!file || !paymentId) return;
    if (file.type !== "image/png" && file.type !== "image/jpeg") {
      setError("Use a PNG or JPEG screenshot.");
      return;
    }
    run("Receipt attached. " + name(payments?.find((p) => p.id === paymentId)?.toMemberId ?? "") + " can confirm now.", () =>
      attachReceipt(groupId, paymentId, file),
    );
  }

  return (
    <main className="app-page">
      <button type="button" className="app-link" onClick={onBack}>&larr; All groups</button>
      <h1>{group.name}</h1>

      <div className="app-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "bills"} onClick={() => setTab("bills")}>
          Bills
        </button>
        <button type="button" role="tab" aria-selected={tab === "payments"} onClick={() => setTab("payments")}>
          Payments
          {needs.length > 0 && <span className="app-badge" aria-label={`${needs.length} need your action`}>{needs.length}</span>}
        </button>
      </div>

      {tab === "bills" && <p className="app-note">Bills are coming next.</p>}

      {tab === "payments" && (
        <>
          {needs.length > 0 && <h2 className="app-group-label">Needs your action</h2>}
          <ul className="app-list">
            {needs.map((n) => (
              <li key={n.payment.id} className="app-item app-item-needs">
                <div className="app-item-title">
                  {n.kind === "confirm"
                    ? `${name(n.payment.fromMemberId)} sent ${formatPeso(n.payment.totalCentavos)}`
                    : "Attach your receipt"}
                </div>
                <div className="app-item-meta">
                  {n.kind === "confirm"
                    ? "Check the receipt, then confirm or dispute."
                    : `You paid ${name(n.payment.toMemberId)} ${formatPeso(n.payment.totalCentavos)}. ${name(n.payment.toMemberId)} can't confirm until it's here.`}
                </div>
                {n.kind === "receipt" ? (
                  <button
                    type="button"
                    className="app-action"
                    disabled={busy}
                    onClick={() => {
                      receiptFor.current = n.payment.id;
                      fileInput.current?.click();
                    }}
                  >
                    {n.payment.status === "disputed" ? "Attach a new receipt" : "Attach receipt"} &rarr;
                  </button>
                ) : (
                  <div className="app-actions">
                    <button
                      type="button"
                      className="app-action"
                      disabled={busy}
                      onClick={() => run("Payment confirmed.", () => api("POST", `/groups/${groupId}/payments/${n.payment.id}/confirm`))}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      className="app-action app-action-quiet"
                      disabled={busy}
                      onClick={() => run("Payment disputed.", () => api("POST", `/groups/${groupId}/payments/${n.payment.id}/dispute`))}
                    >
                      Dispute
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <h2 className="app-group-label">Earlier</h2>
          <ul className="app-list">
            {earlier.length === 0 && <li className="app-empty">No other payments yet.</li>}
            {earlier.map((p) => (
              <li key={p.id} className="app-item">
                <div className="app-item-title">
                  {p.fromMemberId === me.id ? `You paid ${name(p.toMemberId)}` : `${name(p.fromMemberId)} paid you`}
                </div>
                <div className="app-item-amount">{formatPeso(p.totalCentavos)}</div>
                <div className="app-item-meta">{statusText(p)}</div>
              </li>
            ))}
          </ul>
        </>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg"
        hidden
        onChange={(e) => {
          onFileChosen(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {error && <p className="app-error" role="alert">{error}</p>}
      {toast && <div className="app-toast" role="status">{toast}</div>}
    </main>
  );
}

function statusText(p: Payment): string {
  switch (p.status) {
    case "pending":
      return p.hasProof ? "Waiting for confirmation" : "Waiting for receipt";
    case "disputed":
      return "Disputed. Waiting for a new receipt";
    case "confirmed":
      return "Confirmed";
    case "rejected":
      return "Rejected";
  }
}
