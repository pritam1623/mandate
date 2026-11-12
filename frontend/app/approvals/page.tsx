"use client";
import { Check, ExternalLink, Inbox, Loader2, Lock, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useChat } from "@/components/ChatProvider";
import { useToast } from "@/components/Toast";
import { Empty, ErrorNote, PageHeader, Skeleton, StatusBadge } from "@/components/ui";
import { ago, api, money, Order } from "@/lib/api";

export default function Approvals() {
  const { version } = useChat();
  const toast = useToast();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const load = () =>
    Promise.all([api<Order[]>("/orders?status=pending_approval"), api<Order[]>("/orders?status=awaiting_payer")])
      .then(([a, b]) => setOrders([...a, ...b]))
      .catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(o: Order, action: "approve" | "reject") {
    setBusy(o.id + action);
    setErr("");
    try {
      await api(`/orders/${o.id}/${action}`, { method: "POST" });
      toast(action === "approve" ? `Paid ${money(o.total, o.currency)} through PayPal` : "Rejected. PayPal released the hold.");
      await load();
    } catch (e: any) {
      setErr(e.message);
      toast("That didn’t work", "bad");
    } finally {
      setBusy("");
    }
  }

  return (
    <div>
      <PageHeader title="Approvals" subtitle="Orders over your auto-pay limit wait here. PayPal holds the money; nothing is taken until you approve." />
      {err && <div className="mb-4"><ErrorNote>{err}</ErrorNote></div>}
      {orders === null && <div className="space-y-3"><Skeleton className="h-48" /></div>}
      {orders?.length === 0 && (
        <Empty icon={Inbox} title="You’re all caught up" body="When the agent wants to spend more than your auto-pay limit, the order appears here for a one-tap decision."
          action={<Link href="/agent" className="btn-ghost">Open the agent</Link>} />
      )}
      <div className="space-y-4">
        {orders?.map((o) => {
          const payer = o.status === "awaiting_payer";
          return (
            <div key={o.id} className="card animate-in overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-4 p-5">
                <div>
                  <div className="flex items-center gap-2"><StatusBadge status={o.status} /><span className="text-xs text-faint">{o.created_at && ago(o.created_at)}</span></div>
                  <div className="mt-2 text-3xl font-semibold tracking-tight tnum">{money(o.total, o.currency)}</div>
                  <Link href={`/orders/${o.id}`} className="mt-1 inline-block font-mono text-xs text-faint hover:text-brand">{o.id}</Link>
                </div>
                <div className="flex gap-2">
                  <button className="btn-danger" disabled={!!busy} onClick={() => act(o, "reject")}>
                    {busy === o.id + "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}Reject
                  </button>
                  {payer && o.approve_url ? (
                    <a className="btn-primary" href={o.approve_url}><ExternalLink className="h-4 w-4" />Approve in PayPal</a>
                  ) : (
                    <button className="btn-primary" disabled={!!busy} onClick={() => act(o, "approve")}>
                      {busy === o.id + "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Approve &amp; pay
                    </button>
                  )}
                </div>
              </div>
              <div className="border-t border-line-2 px-5 py-4">
                <ul className="space-y-2 text-sm">
                  {o.items.map((i, k) => (
                    <li key={k} className="flex justify-between gap-4">
                      <span className="text-ink-2"><span className="text-faint tnum">{i.quantity}×</span> {i.title}<span className="text-faint"> · {i.merchant}</span></span>
                      <span className="font-medium tnum">{money(i.line_total ?? 0, o.currency)}</span>
                    </li>
                  ))}
                </ul>
                {o.agent_reasoning && (
                  <div className="mt-4 rounded-xl bg-canvas px-3.5 py-2.5 text-sm text-ink-2">
                    <span className="font-medium text-ink">Why the agent chose this: </span>{o.agent_reasoning}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 bg-amber-50/60 px-5 py-2.5 text-xs text-warn">
                {payer ? <Lock className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                {payer ? "No PayPal wallet is saved, so this order needs your approval in PayPal. Save one in Settings to let the agent pay on its own." : `${o.reasons[0]} PayPal is holding the funds.`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
