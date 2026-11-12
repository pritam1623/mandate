"use client";
import {
  ArrowUp, Ban, Bot, CheckCircle2, ChevronDown, ListChecks, Lock, PackageSearch, Plus, ReceiptText, RotateCcw,
  ShieldCheck, ShoppingCart, Sparkles, Store, Tag, Zap,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Step, useChat } from "@/components/ChatProvider";
import Markdown from "@/components/Markdown";
import { Chip, Meter, StatusBadge } from "@/components/ui";
import { api, Mandate, money } from "@/lib/api";

const SUGGESTIONS = [
  { icon: ShoppingCart, text: "Restock 12 oz cups with lids and a pack of napkins", hint: "Small order, paid instantly" },
  { icon: Zap, text: "Our espresso machine's group head is leaking. Buy the part we need.", hint: "Over the limit, held for you" },
  { icon: Ban, text: "Buy noise-cancelling headphones for the counter", hint: "Breaks a rule, blocked" },
  { icon: RotateCcw, text: "The napkins from my last order arrived soaked. Get a refund.", hint: "PayPal refund" },
];

const TOOL: Record<string, { label: string; icon: any }> = {
  search_products: { label: "Searched products", icon: PackageSearch },
  check_cart: { label: "Checked the cart against your rules", icon: ShieldCheck },
  place_order: { label: "Placed the order with PayPal", icon: ShoppingCart },
  list_recent_orders: { label: "Looked up recent orders", icon: ReceiptText },
  request_refund: { label: "Requested a PayPal refund", icon: RotateCcw },
};

function ProductStrip({ products }: { products: any[] }) {
  if (!products?.length) return null;
  return (
    <div className="-mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1">
      {products.slice(0, 6).map((p) => (
        <div key={p.id} className="w-40 shrink-0 rounded-xl border border-line bg-white p-2">
          <div className="grid h-20 place-items-center overflow-hidden rounded-lg bg-line-2">
            {p.image
              ? <img src={p.image} alt="" className="h-full w-full object-contain" loading="lazy" /> // eslint-disable-line @next/next/no-img-element
              : <PackageSearch className="h-5 w-5 text-faint" />}
          </div>
          <div className="mt-2 line-clamp-2 text-xs leading-snug text-ink">{p.title}</div>
          <div className="mt-1 flex items-center justify-between text-[11px]">
            <span className="font-semibold text-ink tnum">{money(p.price, p.currency || "USD")}</span>
            <span className="truncate pl-2 text-faint">{p.merchant}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function OrderCard({ o }: { o: any }) {
  const tone = o.status === "captured" ? "border-emerald-200 bg-emerald-50/50"
    : o.status === "declined" ? "border-red-200 bg-red-50/40"
    : o.status === "refunded" ? "border-violet-200 bg-violet-50/40" : "border-amber-200 bg-amber-50/50";
  return (
    <div className={`mt-2 rounded-xl border p-3 ${tone}`}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={o.status} />
        <span className="text-sm font-semibold tnum">{money(o.total, o.currency || "USD")}</span>
        <span className="ml-auto flex gap-3 text-xs">
          {o.status === "pending_approval" && <Link className="font-medium text-warn hover:underline" href="/approvals">Review &amp; approve</Link>}
          {o.approve_url && o.status === "awaiting_payer" && <a className="font-medium text-warn hover:underline" href={o.approve_url}>Approve in PayPal</a>}
          {o.id && <Link className="text-ink-2 hover:text-brand hover:underline" href={`/orders/${o.id}`}>View order</Link>}
        </span>
      </div>
      {o.items?.length > 0 && (
        <div className="mt-2 text-xs text-ink-2">{o.items.map((i: any) => `${i.quantity} × ${i.title}`).join(" · ")}</div>
      )}
      {o.status === "declined" && o.reasons?.[0] && <div className="mt-1.5 text-xs text-bad">{o.reasons[0]}</div>}
    </div>
  );
}

function Steps({ steps }: { steps: Step[] }) {
  const [open, setOpen] = useState(true);
  if (!steps.length) return null;
  return (
    <div className="rounded-2xl border border-line bg-canvas/70">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-xs font-medium text-ink-2">
        <ListChecks className="h-3.5 w-3.5 text-brand" />
        Worked through {steps.length} {steps.length === 1 ? "step" : "steps"}
        <ChevronDown className={`ml-auto h-3.5 w-3.5 text-faint transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ol className="space-y-3 px-3.5 pb-3.5">
          {steps.map((s, i) => {
            const t = TOOL[s.tool] || { label: s.tool, icon: Sparkles };
            const o = s.output || {};
            let detail: React.ReactNode = null;
            if (o.error) detail = <div className="text-xs text-bad">{o.error}</div>;
            else if (s.tool === "search_products") detail = (
              <>
                <div className="text-xs text-muted">“{s.input.query}” · {o.products?.length ?? 0} results{o.source === "channel3" ? " from Channel3" : ""}</div>
                <ProductStrip products={o.products} />
              </>
            );
            else if (s.tool === "check_cart") detail = (
              <div className="text-xs text-muted">
                <span className={`font-medium ${o.decision === "allow" ? "text-ok" : o.decision === "deny" ? "text-bad" : "text-warn"}`}>
                  {o.decision === "allow" ? "Allowed" : o.decision === "deny" ? "Not allowed" : "Needs approval"}
                </span> · {money(o.total)} · {o.reasons?.[0]}
              </div>
            );
            else if (s.tool === "place_order" || s.tool === "request_refund") detail = <OrderCard o={o} />;
            else if (s.tool === "list_recent_orders") detail = <div className="text-xs text-muted">{o.orders?.length ?? 0} orders found</div>;
            return (
              <li key={i} className="flex gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg border border-line bg-white text-ink-2"><t.icon className="h-3.5 w-3.5" /></span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="text-xs font-medium text-ink">{t.label}</div>
                  {detail}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function Avatar() {
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm shadow-indigo-500/30">
      <Bot className="h-4 w-4" />
    </span>
  );
}

function Thinking() {
  return (
    <div className="flex animate-in gap-3">
      <Avatar />
      <div className="rounded-2xl border border-line bg-white px-4 py-3 text-sm text-muted">
        <span className="mr-2 inline-flex gap-1 align-middle">
          {[0, 150, 300].map((d) => <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand" style={{ animationDelay: `${d}ms` }} />)}
        </span>
        Searching, checking your rules, talking to PayPal…
        <div className="mt-1 text-xs text-faint">You can switch pages; the reply will be waiting here.</div>
      </div>
    </div>
  );
}

export default function AgentPage() {
  const { mandateId: mid, setMandateId, turns, busy, err, send: sendChat, clear, version } = useChat();
  const [mandates, setMandates] = useState<Mandate[]>([]);
  const [text, setText] = useState("");
  const [loadErr, setLoadErr] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api("/demo/seed", { method: "POST" })
      .then(() => api<Mandate[]>("/mandates"))
      .then((ms) => {
        setMandates(ms);
        if (ms[0] && !ms.some((m) => m.id === mid)) setMandateId(ms[0].id);
      })
      .catch((e) => setLoadErr(e.message));
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);
  useEffect(() => {
    const el = box.current;
    if (el) { el.style.height = "0px"; el.style.height = Math.min(160, el.scrollHeight) + "px"; }
  }, [text]);

  const m = mandates.find((x) => x.id === mid);

  function send(msg: string) {
    if (!msg.trim() || busy) return;
    setText("");
    sendChat(msg.trim());
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <section className="card flex h-[calc(100vh-7rem)] min-h-[560px] flex-col overflow-hidden lg:h-[calc(100vh-5rem)]">
        <header className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <Avatar />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Purchasing agent</div>
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <span className={`h-1.5 w-1.5 rounded-full ${busy ? "animate-pulse bg-amber-500" : "bg-emerald-500"}`} />
              {busy ? "Working…" : "Ready"} · pays with PayPal inside your rules
            </div>
          </div>
          {turns.length > 0 && (
            <button className="btn-ghost h-8 px-2.5 text-xs" disabled={busy} onClick={clear}><Plus className="h-3.5 w-3.5" />New chat</button>
          )}
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-6">
          {turns.length === 0 && (
            <div className="mx-auto max-w-xl animate-in py-6 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/30">
                <Sparkles className="h-5 w-5" />
              </div>
              <h1 className="mt-4 text-xl font-semibold tracking-tight">What should I buy?</h1>
              <p className="mt-1 text-sm text-muted">I’ll search, compare and pay with PayPal, and I can’t step outside the rules on the right.</p>
              <div className="mt-6 grid gap-2 text-left sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s.text} onClick={() => send(s.text)} disabled={busy}
                    className="group rounded-2xl border border-line bg-white p-3.5 text-left transition hover:border-indigo-200 hover:shadow-[var(--shadow-pop)]">
                    <s.icon className="h-4 w-4 text-brand" />
                    <div className="mt-2 text-sm leading-snug text-ink">{s.text}</div>
                    <div className="mt-1 text-xs text-faint">{s.hint}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((t, i) => t.role === "user" ? (
            <div key={i} className="flex animate-in justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-sm text-white">{t.content}</div>
            </div>
          ) : (
            <div key={i} className="flex animate-in gap-3">
              <Avatar />
              <div className="min-w-0 max-w-[92%] flex-1 space-y-3">
                {t.steps && <Steps steps={t.steps} />}
                <Markdown text={t.content} className="text-sm leading-relaxed text-ink-2" />
              </div>
            </div>
          ))}
          {busy && <Thinking />}
          {(err || loadErr) && <div className="rounded-xl border border-red-200 bg-bad-soft px-4 py-3 text-sm text-bad">{err || loadErr}</div>}
          <div ref={end} />
        </div>

        <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="border-t border-line p-3">
          <div className="flex items-end gap-2 rounded-2xl border border-line bg-white p-1.5 pl-3.5 transition focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/10">
            <textarea ref={box} rows={1} value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } }}
              placeholder="Ask me to buy, compare or refund something…"
              className="max-h-40 flex-1 resize-none bg-transparent py-2 text-sm outline-none placeholder:text-faint" />
            <button className="btn-primary h-9 w-9 shrink-0 rounded-xl px-0" disabled={busy || !text.trim()} aria-label="Send">
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-1.5 px-1 text-[11px] text-faint">Enter to send · Shift+Enter for a new line</div>
        </form>
      </section>

      <aside className="space-y-4">
        <div className="card p-4">
          <label className="eyebrow mb-2 block">Acting under mandate</label>
          <select className="input" value={mid} onChange={(e) => setMandateId(e.target.value)}>
            {mandates.map((x) => <option key={x.id} value={x.id}>{x.name}{x.active ? "" : " (paused)"}</option>)}
          </select>
          {m && (
            <>
              <div className="mt-4 flex items-baseline justify-between">
                <span className="text-2xl font-semibold tracking-tight tnum">{money(m.budget_left)}</span>
                <span className="text-xs text-muted tnum">left of {money(m.weekly_budget)}</span>
              </div>
              <Meter className="mt-2" value={m.spent_this_week} max={m.weekly_budget} />
              <ul className="mt-4 space-y-2.5 text-sm">
                <li className="flex items-center gap-2.5"><Tag className="h-4 w-4 text-faint" /><span className="flex-1 text-ink-2">Per-order cap</span><span className="font-medium tnum">{money(m.per_order_cap)}</span></li>
                <li className="flex items-center gap-2.5"><CheckCircle2 className="h-4 w-4 text-faint" /><span className="flex-1 text-ink-2">Auto-pay up to</span><span className="font-medium tnum">{money(m.auto_approve_limit)}</span></li>
                <li className="flex items-start gap-2.5"><ListChecks className="mt-0.5 h-4 w-4 text-faint" /><span className="flex flex-1 flex-wrap gap-1">{m.allowed_categories.length ? m.allowed_categories.map((c) => <Chip key={c}>{c}</Chip>) : <span className="text-ink-2">Any category</span>}</span></li>
                <li className="flex items-start gap-2.5"><Store className="mt-0.5 h-4 w-4 text-faint" /><span className="flex flex-1 flex-wrap gap-1">{m.allowed_merchants.length ? m.allowed_merchants.map((c) => <Chip key={c}>{c}</Chip>) : <span className="text-ink-2">Any merchant</span>}</span></li>
              </ul>
            </>
          )}
        </div>
        <div className="flex gap-3 rounded-2xl border border-indigo-100 bg-brand-soft/60 p-4 text-xs leading-relaxed text-ink-2">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
          <span><span className="font-medium text-ink">Rules are enforced in code, not in the prompt.</span> Every order is re-checked on the server before PayPal is called, so the agent can’t overspend, even if it tries.</span>
        </div>
      </aside>
    </div>
  );
}
