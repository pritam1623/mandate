"use client";
import { ChevronRight, ReceiptText, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useChat } from "@/components/ChatProvider";
import { Empty, ErrorNote, PageHeader, Skeleton, StatusBadge } from "@/components/ui";
import { ago, api, money, Order } from "@/lib/api";

const TABS = [
  { key: "all", label: "All", match: () => true },
  { key: "paid", label: "Paid", match: (o: Order) => o.status === "captured" },
  { key: "waiting", label: "Waiting", match: (o: Order) => o.status === "pending_approval" || o.status === "awaiting_payer" },
  { key: "blocked", label: "Blocked", match: (o: Order) => o.status === "declined" },
  { key: "refunded", label: "Refunded", match: (o: Order) => o.status === "refunded" || o.status === "voided" },
];

export default function Orders() {
  const { version } = useChat();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  useEffect(() => { api<Order[]>("/orders").then(setOrders).catch((e) => setErr(e.message)); }, [version]);

  const shown = useMemo(() => {
    const t = TABS.find((x) => x.key === tab)!;
    const s = q.trim().toLowerCase();
    return (orders || []).filter((o) => t.match(o) && (!s || o.items.some((i) => i.title.toLowerCase().includes(s)) || o.id.includes(s)));
  }, [orders, tab, q]);

  return (
    <div>
      <PageHeader title="Orders" subtitle="Everything the agent bought, held or was stopped from buying." />
      {err && <div className="mb-4"><ErrorNote>{err}</ErrorNote></div>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex max-w-full overflow-x-auto rounded-xl border border-line bg-white p-1">
          {TABS.map((t) => {
            const n = (orders || []).filter(t.match).length;
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-sm transition ${tab === t.key ? "bg-ink text-white" : "text-muted hover:text-ink"}`}>
                {t.label}<span className={`ml-1.5 text-xs tnum ${tab === t.key ? "text-white/60" : "text-faint"}`}>{n}</span>
              </button>
            );
          })}
        </div>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint" />
          <input className="input pl-9" placeholder="Search items or order id" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {orders === null && <Skeleton className="h-64" />}
      {orders && shown.length === 0 && (
        <Empty icon={ReceiptText} title={orders.length ? "No orders match" : "No orders yet"}
          body={orders.length ? "Try another filter or search." : "Ask the agent to buy something and it will show up here."} />
      )}
      {shown.length > 0 && (
        <div className="card overflow-hidden">
          <ul className="divide-y divide-line-2">
            {shown.map((o) => (
              <li key={o.id}>
                <Link href={`/orders/${o.id}`} className="group flex items-center gap-3 px-4 py-4 transition hover:bg-canvas sm:gap-4 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">{o.items.map((i) => i.title).join(", ")}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint">
                      <span className="sm:hidden"><StatusBadge status={o.status} /></span>
                      <span>{o.items.reduce((s, i) => s + i.quantity, 0)} {o.items.reduce((s, i) => s + i.quantity, 0) === 1 ? "item" : "items"}</span><span>·</span>
                      <span>{o.created_at && ago(o.created_at)}</span>
                      <span className="hidden font-mono sm:inline">· {o.id}</span>
                    </div>
                  </div>
                  <span className="hidden sm:inline"><StatusBadge status={o.status} /></span>
                  <span className="text-right text-sm font-semibold tnum sm:w-20">{money(o.total, o.currency)}</span>
                  <ChevronRight className="h-4 w-4 text-faint transition group-hover:translate-x-0.5 group-hover:text-ink" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
