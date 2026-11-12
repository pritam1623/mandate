"use client";
import { CheckCircle2, ListChecks, Pause, Play, Plus, SlidersHorizontal, Store, Tag, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useChat } from "@/components/ChatProvider";
import { useToast } from "@/components/Toast";
import { Chip, Empty, ErrorNote, Meter, PageHeader, Skeleton } from "@/components/ui";
import { api, Mandate, money } from "@/lib/api";

const CATEGORIES = ["supplies", "cleaning", "pantry", "coffee", "equipment", "electronics"];
const EMPTY = { name: "", weekly_budget: "150", per_order_cap: "80", auto_approve_limit: "25", categories: ["supplies"], merchants: "" };

function NewMandate({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState(EMPTY);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const toggle = (c: string) => setF((s) => ({ ...s, categories: s.categories.includes(c) ? s.categories.filter((x) => x !== c) : [...s.categories, c] }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api("/mandates", {
        method: "POST",
        body: JSON.stringify({
          name: f.name.trim(),
          weekly_budget: Number(f.weekly_budget),
          per_order_cap: Number(f.per_order_cap),
          auto_approve_limit: Number(f.auto_approve_limit),
          allowed_categories: f.categories,
          allowed_merchants: f.merchants.split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      onCreated();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={onClose} />
      <form onSubmit={submit} className="relative w-full max-w-lg animate-in rounded-2xl bg-white p-6 shadow-[var(--shadow-pop)]">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">New mandate</h2>
            <p className="mt-0.5 text-sm text-muted">The rules your agent must follow when it spends.</p>
          </div>
          <button type="button" className="btn-ghost h-8 w-8 px-0" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-5 space-y-4">
          <div><label className="label">Name</label><input className="input" required autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Office supplies" /></div>
          <div className="grid grid-cols-3 gap-3">
            {([["weekly_budget", "Weekly budget"], ["per_order_cap", "Per-order cap"], ["auto_approve_limit", "Auto-pay up to"]] as const).map(([k, l]) => (
              <div key={k}>
                <label className="label">{l}</label>
                <div className="relative"><span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-faint">$</span>
                  <input className="input pl-6 tnum" type="number" min="0" step="0.01" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
              </div>
            ))}
          </div>
          <div>
            <label className="label">Allowed categories <span className="font-normal text-faint">(none selected = any)</span></label>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => {
                const on = f.categories.includes(c);
                return (
                  <button type="button" key={c} onClick={() => toggle(c)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium ring-1 transition ${on ? "bg-brand-soft text-brand ring-indigo-200" : "text-muted ring-line hover:text-ink"}`}>
                    {on && <CheckCircle2 className="mr-1 inline h-3 w-3" />}{c}
                  </button>
                );
              })}
            </div>
          </div>
          <div><label className="label">Allowed merchants <span className="font-normal text-faint">(comma-separated, blank = any)</span></label>
            <input className="input" value={f.merchants} onChange={(e) => setF({ ...f, merchants: e.target.value })} placeholder="CafeSupplyCo, CleanPro" /></div>
          {err && <ErrorNote>{err}</ErrorNote>}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || !f.name.trim()}>Create mandate</button>
        </div>
      </form>
    </div>
  );
}

export default function Mandates() {
  const { version } = useChat();
  const toast = useToast();
  const [list, setList] = useState<Mandate[] | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");

  const load = () => api<Mandate[]>("/mandates").then(setList).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggle(m: Mandate) {
    await api(`/mandates/${m.id}`, { method: "PATCH", body: JSON.stringify({ active: !m.active }) });
    toast(m.active ? `Paused “${m.name}”. The agent can’t spend under it.` : `Resumed “${m.name}”`);
    load();
  }

  return (
    <div>
      <PageHeader title="Mandates" subtitle="A mandate is a spending policy for your agent: budget, limits, and what it may buy where."
        action={<button className="btn-primary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />New mandate</button>} />
      {err && <div className="mb-4"><ErrorNote>{err}</ErrorNote></div>}
      {list === null && <Skeleton className="h-48" />}
      {list?.length === 0 && <Empty icon={SlidersHorizontal} title="No mandates yet" body="Create one to let the agent spend." />}
      <div className="grid gap-4 md:grid-cols-2">
        {list?.map((m) => (
          <div key={m.id} className={`card animate-in p-5 ${m.active ? "" : "opacity-70"}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{m.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${m.active ? "bg-ok-soft text-ok" : "bg-line-2 text-muted"}`}>{m.active ? "Active" : "Paused"}</span>
                </div>
                <div className="mt-3 text-2xl font-semibold tracking-tight tnum">{money(m.budget_left)}<span className="ml-1.5 text-sm font-normal text-muted">left this week</span></div>
              </div>
              <button className="btn-ghost h-8 px-2.5 text-xs" onClick={() => toggle(m)}>
                {m.active ? <><Pause className="h-3.5 w-3.5" />Pause</> : <><Play className="h-3.5 w-3.5" />Resume</>}
              </button>
            </div>
            <Meter className="mt-3" value={m.spent_this_week} max={m.weekly_budget} />
            <div className="mt-1.5 flex justify-between text-[11px] text-faint tnum"><span>{money(m.spent_this_week)} spent or held</span><span>of {money(m.weekly_budget)}</span></div>
            <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-canvas p-3 text-sm">
              <div className="flex items-center gap-2"><Tag className="h-4 w-4 text-faint" /><span className="text-muted">Per order</span><span className="ml-auto font-medium tnum">{money(m.per_order_cap)}</span></div>
              <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-faint" /><span className="text-muted">Auto-pay</span><span className="ml-auto font-medium tnum">{money(m.auto_approve_limit)}</span></div>
            </div>
            <div className="mt-3 space-y-2 text-xs">
              <div className="flex items-start gap-2"><ListChecks className="mt-0.5 h-3.5 w-3.5 text-faint" /><div className="flex flex-wrap gap-1">{m.allowed_categories.length ? m.allowed_categories.map((c) => <Chip key={c}>{c}</Chip>) : <span className="text-muted">Any category</span>}</div></div>
              <div className="flex items-start gap-2"><Store className="mt-0.5 h-3.5 w-3.5 text-faint" /><div className="flex flex-wrap gap-1">{m.allowed_merchants.length ? m.allowed_merchants.map((c) => <Chip key={c}>{c}</Chip>) : <span className="text-muted">Any merchant</span>}</div></div>
            </div>
          </div>
        ))}
      </div>
      {open && <NewMandate onClose={() => setOpen(false)} onCreated={() => { setOpen(false); toast("Mandate created"); load(); }} />}
    </div>
  );
}
