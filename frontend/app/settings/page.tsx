"use client";
import { Cpu, CreditCard, KeyRound, Link2, Loader2, PackageSearch, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { ErrorNote, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";

type Health = { paypal: string; catalog: string; llm: string | null };

function Pill({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${ok ? "bg-ok-soft text-ok" : "bg-line-2 text-muted"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-slate-400"}`} />{children}
    </span>
  );
}

export default function Settings() {
  const [h, setH] = useState<Health | null>(null);
  const [pm, setPm] = useState<{ connected: boolean; payer_email: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api<Health>("/health").then(setH).catch((e) => setErr(e.message));
    api("/payment-method").then(setPm).catch(() => {});
  }, []);

  async function connect() {
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ id: string; approve_url: string }>("/payment-method/setup", { method: "POST" });
      window.location.href = r.approve_url;
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }

  const rows = [
    { icon: CreditCard, name: "PayPal", desc: "Orders v2 · authorize, capture, void, refund · webhooks", ok: h?.paypal === "sandbox", value: h ? (h.paypal === "sandbox" ? "Sandbox" : "Mock mode") : "…" },
    { icon: Cpu, name: "AI model", desc: "Plans, compares and explains with tool calling", ok: !!h?.llm, value: h ? h.llm || "Not configured" : "…" },
    { icon: PackageSearch, name: "Product search", desc: "Where the agent looks for products", ok: h?.catalog === "channel3", value: h ? (h.catalog === "channel3" ? "Channel3" : "Demo catalog") : "…" },
  ];

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" subtitle="Connections that let the agent search, decide and pay." />
      {err && <div className="mb-4"><ErrorNote>{err}</ErrorNote></div>}

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-4 p-5">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-soft text-brand"><Wallet className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">PayPal wallet for the agent</span>
              <Pill ok={!!pm?.connected}>{pm?.connected ? "Connected" : "Not connected"}</Pill>
            </div>
            <div className="mt-0.5 truncate text-sm text-muted">{pm?.connected ? pm.payer_email : "Save a wallet once and the agent can pay without a popup."}</div>
          </div>
          <button className={pm?.connected ? "btn-ghost" : "btn-primary"} onClick={connect} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}{pm?.connected ? "Reconnect" : "Connect PayPal"}
          </button>
        </div>
        <div className="flex gap-2 border-t border-line-2 bg-canvas px-5 py-3 text-xs text-muted">
          <KeyRound className="h-3.5 w-3.5 shrink-0" />
          Uses PayPal Vault. The agent never sees your login or card details, and every payment is still checked against your mandate first.
        </div>
      </div>

      <div className="card mt-5 divide-y divide-line-2">
        {rows.map((r) => (
          <div key={r.name} className="flex items-center gap-4 px-5 py-4">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-line-2 text-ink-2"><r.icon className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1"><div className="text-sm font-medium">{r.name}</div><div className="truncate text-xs text-muted">{r.desc}</div></div>
            <Pill ok={r.ok}>{r.value}</Pill>
          </div>
        ))}
      </div>
    </div>
  );
}
