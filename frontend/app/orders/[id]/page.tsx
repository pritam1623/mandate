"use client";
import { ArrowLeft, Ban, Bot, Check, Copy, CreditCard, ExternalLink, Loader2, RotateCcw, ShieldCheck, User, Webhook } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useChat } from "@/components/ChatProvider";
import { useToast } from "@/components/Toast";
import { ErrorNote, Skeleton, StatusBadge } from "@/components/ui";
import { api, AuditEvent, money, Order, when } from "@/lib/api";

type Full = Order & { events: AuditEvent[] };

const KIND: Record<string, any> = { agent_tool: Bot, policy: ShieldCheck, paypal: CreditCard, webhook: Webhook, user: User };

function Progress({ o }: { o: Full }) {
  if (o.status === "declined") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-bad-soft px-4 py-3 text-sm text-bad">
        <Ban className="h-4 w-4 shrink-0" />Blocked by the mandate before PayPal was called. No money moved.
      </div>
    );
  }
  const steps = [
    { label: "Rules checked", done: true },
    { label: "Funds authorized", done: !!o.paypal_authorization_id },
    { label: o.status === "voided" ? "Rejected, hold released" : "Paid", done: !!o.paypal_capture_id || o.status === "voided", bad: o.status === "voided" },
    ...(o.status === "refunded" ? [{ label: "Refunded", done: true }] : []),
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <ol className="flex items-center">
      {steps.map((s, i) => (
        <li key={s.label} className="flex flex-1 items-center last:flex-none">
          <div className="flex flex-col items-center gap-1.5">
            <span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-semibold ${
              s.done ? (s.bad ? "bg-slate-200 text-slate-600" : "bg-brand text-white") : i === current ? "border-2 border-amber-400 bg-amber-50 text-warn" : "border border-line bg-white text-faint"}`}>
              {s.done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
            </span>
            <span className={`text-[11px] whitespace-nowrap ${s.done ? "text-ink" : "text-faint"}`}>{s.label}</span>
          </div>
          {i < steps.length - 1 && <span className={`mx-2 mb-5 h-0.5 flex-1 rounded ${steps[i + 1].done ? "bg-brand" : "bg-line"}`} />}
        </li>
      ))}
    </ol>
  );
}

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const { version } = useChat();
  const toast = useToast();
  const [o, setO] = useState<Full | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = () => api<Full>(`/orders/${id}`).then(setO).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id, version]); // eslint-disable-line react-hooks/exhaustive-deps

  async function refund() {
    setBusy(true);
    setErr("");
    try {
      await api(`/orders/${id}/refund`, { method: "POST", body: JSON.stringify({ reason }) });
      setReason("");
      toast("Refunded through PayPal");
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (err && !o) return <ErrorNote>{err}</ErrorNote>;
  if (!o) return <div className="space-y-4"><Skeleton className="h-10 w-40" /><Skeleton className="h-64" /></div>;

  const refs = [
    ["PayPal order", o.paypal_order_id],
    ["Authorization", o.paypal_authorization_id],
    ["Capture", o.paypal_capture_id],
    ["Refund", o.paypal_refund_id],
  ].filter(([, v]) => v) as [string, string][];

  return (
    <div className="space-y-5">
      <Link href="/orders" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Orders</Link>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2"><StatusBadge status={o.status} /><span className="font-mono text-xs text-faint">{o.id}</span></div>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight tnum">{money(o.total, o.currency)}</h1>
          <div className="mt-1 text-sm text-muted">{when(o.created_at)}</div>
        </div>
        {o.status === "awaiting_payer" && o.approve_url && <a className="btn-primary" href={o.approve_url}><ExternalLink className="h-4 w-4" />Approve in PayPal</a>}
      </div>

      <div className="card p-5"><Progress o={o} /></div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <div className="card">
            <div className="border-b border-line-2 px-5 py-3.5 text-sm font-medium">Items</div>
            <ul className="divide-y divide-line-2">
              {o.items.map((i, k) => (
                <li key={k} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <div className="text-sm text-ink">{i.title}</div>
                    <div className="text-xs text-faint">{i.merchant} · {i.category} · {i.quantity} × {money(i.unit_price ?? 0, o.currency)}</div>
                  </div>
                  <span className="text-sm font-medium tnum">{money(i.line_total ?? 0, o.currency)}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-between border-t border-line px-5 py-3 text-sm font-semibold"><span>Total</span><span className="tnum">{money(o.total, o.currency)}</span></div>
          </div>

          <div className="card space-y-3 p-5 text-sm">
            {o.agent_reasoning && (
              <div className="flex gap-3"><Bot className="mt-0.5 h-4 w-4 shrink-0 text-brand" /><div><div className="font-medium">Why the agent bought this</div><div className="text-ink-2">{o.agent_reasoning}</div></div></div>
            )}
            <div className="flex gap-3"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-warn" /><div><div className="font-medium">Mandate decision</div><ul className="text-ink-2">{o.reasons.map((r, k) => <li key={k}>{r}</li>)}</ul></div></div>
            {o.refund_reason && <div className="flex gap-3"><RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-info" /><div><div className="font-medium">Refund reason</div><div className="text-ink-2">{o.refund_reason}</div></div></div>}
          </div>

          <div className="card p-5">
            <div className="mb-4 text-sm font-medium">Timeline</div>
            <ol className="space-y-4">
              {o.events.map((e, k) => {
                const Icon = KIND[e.kind] || User;
                return (
                  <li key={e.id} className="relative flex gap-3">
                    {k < o.events.length - 1 && <span className="absolute top-7 bottom-[-16px] left-[13px] w-px bg-line" />}
                    <span className="relative grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line bg-white text-ink-2"><Icon className="h-3.5 w-3.5" /></span>
                    <div className="pt-0.5"><div className="text-sm text-ink">{e.message}</div><div className="text-xs text-faint">{when(e.created_at)}</div></div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        <aside className="space-y-5">
          {refs.length > 0 && (
            <div className="card p-4">
              <div className="eyebrow mb-3">PayPal references</div>
              <div className="space-y-2.5">
                {refs.map(([k, v]) => (
                  <div key={k}>
                    <div className="text-xs text-muted">{k}</div>
                    <button className="group flex w-full items-center gap-2 text-left" onClick={() => { navigator.clipboard?.writeText(v); toast("Copied"); }}>
                      <code className="flex-1 truncate font-mono text-xs text-ink">{v}</code>
                      <Copy className="h-3.5 w-3.5 text-faint opacity-0 group-hover:opacity-100" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {o.status === "captured" && (
            <div className="card space-y-3 p-4">
              <div className="text-sm font-medium">Something wrong with this order?</div>
              <textarea className="input h-auto py-2" rows={3} placeholder="e.g. Cups arrived crushed" value={reason} onChange={(e) => setReason(e.target.value)} />
              <button className="btn-dark w-full" disabled={busy || reason.trim().length < 3} onClick={refund}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}Refund through PayPal
              </button>
              {err && <p className="text-xs text-bad">{err}</p>}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
