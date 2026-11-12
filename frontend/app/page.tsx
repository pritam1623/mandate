"use client";
import {
  Activity, ArrowRight, ArrowUpRight, Ban, Bot, CircleDollarSign, Clock, CreditCard, RotateCcw, ShieldCheck, User, Webhook,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useChat } from "@/components/ChatProvider";
import { ErrorNote, Meter, Skeleton } from "@/components/ui";
import { ago, api, AuditEvent, Mandate, money, Order } from "@/lib/api";

type Dash = {
  mandates: Mandate[];
  total_captured: number;
  total_refunded: number;
  pending_approvals: number;
  blocked_by_policy: number;
  recent_events: AuditEvent[];
};

const KIND: Record<string, { label: string; icon: any; cls: string }> = {
  agent_tool: { label: "Agent", icon: Bot, cls: "bg-brand-soft text-brand" },
  policy: { label: "Policy", icon: ShieldCheck, cls: "bg-amber-50 text-warn" },
  paypal: { label: "PayPal", icon: CreditCard, cls: "bg-sky-50 text-sky-700" },
  webhook: { label: "Webhook", icon: Webhook, cls: "bg-slate-100 text-slate-600" },
  user: { label: "You", icon: User, cls: "bg-emerald-50 text-ok" },
};

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function SpendChart({ orders }: { orders: Order[] }) {
  const days = useMemo(() => {
    const out: { key: string; label: string; paid: number; held: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      out.push({ key: d.toDateString(), label: d.toLocaleDateString(undefined, { weekday: "short" }), paid: 0, held: 0 });
    }
    for (const o of orders) {
      if (!o.created_at) continue;
      const k = new Date(o.created_at.endsWith("Z") || o.created_at.includes("+") ? o.created_at : o.created_at + "Z").toDateString();
      const day = out.find((x) => x.key === k);
      if (!day) continue;
      if (o.status === "captured") day.paid += o.total;
      if (o.status === "pending_approval" || o.status === "awaiting_payer") day.held += o.total;
    }
    return out;
  }, [orders]);
  const max = Math.max(10, ...days.map((d) => d.paid + d.held));
  const total = days.reduce((s, d) => s + d.paid, 0);
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-medium">Spend, last 7 days</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight tnum">{money(total)}</div>
        </div>
        <div className="flex gap-3 text-xs text-muted">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-brand" />Paid</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-amber-300" />Held</span>
        </div>
      </div>
      <div className="mt-6 grid h-40 grid-cols-7 items-end gap-3">
        {days.map((d) => (
          <div key={d.key} className="group flex h-full flex-col items-center justify-end gap-2">
            <div className="relative flex w-full max-w-10 flex-1 flex-col justify-end">
              <div className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 rounded-md bg-ink px-1.5 py-0.5 text-[11px] whitespace-nowrap text-white group-hover:block tnum">
                {money(d.paid + d.held)}
              </div>
              {d.held > 0 && <div className="w-full rounded-t-md bg-amber-300" style={{ height: `${(d.held / max) * 100}%` }} />}
              <div className={`w-full bg-brand ${d.held > 0 ? "" : "rounded-t-md"} ${d.paid + d.held === 0 ? "h-1 rounded-md bg-line" : ""}`}
                style={d.paid > 0 ? { height: `${(d.paid / max) * 100}%` } : undefined} />
            </div>
            <span className="text-[11px] text-faint">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Overview() {
  const { version } = useChat();
  const [d, setD] = useState<Dash | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [err, setErr] = useState("");
  const [all, setAll] = useState(false);
  // Dates depend on the viewer's clock and locale, so only render them in the browser.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); }, []);

  useEffect(() => {
    api("/demo/seed", { method: "POST" })
      .then(() => Promise.all([api<Dash>("/dashboard"), api<Order[]>("/orders")]))
      .then(([dash, os]) => { setD(dash); setOrders(os); })
      .catch((e) => setErr(e.message));
  }, [version]);

  if (err) return <ErrorNote>Can’t reach the backend ({err}). Is it running on port 8000?</ErrorNote>;

  const held = orders.filter((o) => o.status === "pending_approval" || o.status === "awaiting_payer");
  const blocked = orders.filter((o) => o.status === "declined");
  const tiles = d && [
    { label: "Paid through PayPal", value: money(d.total_captured), sub: `${orders.filter((o) => o.status === "captured").length} orders`, icon: CircleDollarSign, cls: "bg-brand-soft text-brand" },
    { label: "Waiting for you", value: String(held.length), sub: held.length ? `${money(held.reduce((s, o) => s + o.total, 0))} held` : "All clear", icon: Clock, cls: "bg-amber-50 text-warn", href: "/approvals" },
    { label: "Blocked by rules", value: String(blocked.length), sub: blocked.length ? `${money(blocked.reduce((s, o) => s + o.total, 0))} not spent` : "Nothing blocked", icon: Ban, cls: "bg-red-50 text-bad" },
    { label: "Refunded", value: money(d.total_refunded), sub: `${orders.filter((o) => o.status === "refunded").length} refunds`, icon: RotateCcw, cls: "bg-violet-50 text-info" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow h-4">{now?.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</div>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight">{now ? greeting() : "Hello"}. Your agent is on duty.</h1>
          <p className="mt-1 text-sm text-muted">Every purchase is checked against your rules before PayPal moves any money.</p>
        </div>
        <Link href="/agent" className="btn-primary"><Bot className="h-4 w-4" />Ask the agent</Link>
      </div>

      {held.length > 0 && (
        <Link href="/approvals" className="flex animate-in items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm transition hover:bg-amber-50">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-amber-100 text-warn"><Clock className="h-4 w-4" /></span>
          <span className="flex-1"><span className="font-medium">{held.length} {held.length === 1 ? "order needs" : "orders need"} your approval.</span> <span className="text-ink-2">PayPal is holding {money(held.reduce((s, o) => s + o.total, 0))} until you decide.</span></span>
          <ArrowRight className="h-4 w-4 text-warn" />
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {!tiles && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[118px]" />)}
        {tiles?.map((t) => {
          const body = (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted">{t.label}</span>
                <span className={`grid h-7 w-7 place-items-center rounded-lg ${t.cls}`}><t.icon className="h-3.5 w-3.5" /></span>
              </div>
              <div className="mt-3 text-[26px] leading-none font-semibold tracking-tight tnum">{t.value}</div>
              <div className="mt-2 text-xs text-faint">{t.sub}</div>
            </>
          );
          return t.href
            ? <Link key={t.label} href={t.href} className="card animate-in p-4 transition hover:border-slate-300">{body}</Link>
            : <div key={t.label} className="card animate-in p-4">{body}</div>;
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        {now ? <SpendChart orders={orders} /> : <Skeleton className="h-[268px]" />}
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Budgets this week</div>
            <Link href="/mandates" className="flex items-center gap-1 text-xs text-muted hover:text-brand">Manage<ArrowUpRight className="h-3 w-3" /></Link>
          </div>
          <div className="mt-4 space-y-5">
            {!d && <Skeleton className="h-16" />}
            {d?.mandates.map((m) => (
              <div key={m.id}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{m.name}{!m.active && <span className="ml-2 text-xs font-normal text-faint">Paused</span>}</span>
                  <span className="text-xs text-muted tnum">{money(m.budget_left)} left</span>
                </div>
                <Meter className="mt-2" value={m.spent_this_week} max={m.weekly_budget} />
                <div className="mt-1.5 flex justify-between text-[11px] text-faint tnum">
                  <span>{money(m.spent_this_week)} spent or held</span><span>of {money(m.weekly_budget)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
          <Activity className="h-4 w-4 text-faint" />
          <span className="text-sm font-medium">Audit log</span>
          <span className="ml-auto text-xs text-faint">Every agent step and money movement</span>
        </div>
        <ul className="divide-y divide-line-2">
          {!d && <li className="p-5"><Skeleton className="h-24" /></li>}
          {d?.recent_events.length === 0 && <li className="px-5 py-8 text-center text-sm text-muted">Nothing yet. Ask the agent to buy something.</li>}
          {d?.recent_events.slice(0, all ? 50 : 8).map((e) => {
            const k = KIND[e.kind] || KIND.user;
            const row = (
              <>
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${k.cls}`}><k.icon className="h-3.5 w-3.5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-ink">{e.message}</span>
                  <span className="text-xs text-faint">{k.label} · {ago(e.created_at)}</span>
                </span>
                {e.order_id && <ArrowRight className="h-4 w-4 shrink-0 text-faint opacity-0 transition group-hover:opacity-100" />}
              </>
            );
            return (
              <li key={e.id}>
                {e.order_id
                  ? <Link href={`/orders/${e.order_id}`} className="group flex items-center gap-3 px-5 py-3 hover:bg-canvas">{row}</Link>
                  : <div className="flex items-center gap-3 px-5 py-3">{row}</div>}
              </li>
            );
          })}
        </ul>
        {d && d.recent_events.length > 8 && (
          <button onClick={() => setAll((a) => !a)} className="w-full border-t border-line-2 py-2.5 text-xs font-medium text-muted hover:bg-canvas hover:text-ink">
            {all ? "Show less" : `Show ${d.recent_events.length - 8} more`}
          </button>
        )}
      </div>
    </div>
  );
}
