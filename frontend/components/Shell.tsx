"use client";
import {
  Bot, Inbox, LayoutDashboard, Menu, ReceiptText, Settings, ShieldCheck, SlidersHorizontal, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useChat } from "./ChatProvider";

const LINKS = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/agent", label: "Agent", icon: Bot },
  { href: "/approvals", label: "Approvals", icon: Inbox },
  { href: "/orders", label: "Orders", icon: ReceiptText },
  { href: "/mandates", label: "Mandates", icon: SlidersHorizontal },
  { href: "/settings", label: "Settings", icon: Settings },
];

type Health = { paypal: string; catalog: string; llm: string | null };

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm shadow-indigo-500/30">
        <ShieldCheck className="h-4.5 w-4.5" strokeWidth={2.25} />
      </span>
      <span className="text-[15px] font-semibold tracking-tight">Mandate</span>
    </Link>
  );
}

function NavLinks({ pending, onNavigate }: { pending: number; onNavigate?: () => void }) {
  const path = usePathname();
  const { busy } = useChat();
  return (
    <nav className="space-y-0.5">
      {LINKS.map(({ href, label, icon: Icon }) => {
        const on = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link key={href} href={href} onClick={onNavigate}
            className={`group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${on ? "bg-white font-medium text-ink shadow-[var(--shadow-card)] ring-1 ring-line" : "text-muted hover:bg-white/70 hover:text-ink"}`}>
            <Icon className={`h-4 w-4 ${on ? "text-brand" : "text-faint group-hover:text-ink-2"}`} />
            <span className="flex-1">{label}</span>
            {href === "/agent" && busy && (
              <span className="relative flex h-2 w-2" title="Agent is working">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
              </span>
            )}
            {href === "/approvals" && pending > 0 && (
              <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-warn tnum">{pending}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function Dot({ on }: { on: boolean }) {
  return <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-emerald-500" : "bg-slate-300"}`} />;
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const { version } = useChat();
  const [health, setHealth] = useState<Health | null>(null);
  const [wallet, setWallet] = useState(false);
  const [pending, setPending] = useState(0);
  const [open, setOpen] = useState(false);
  const path = usePathname();

  useEffect(() => {
    api<Health>("/health").then(setHealth).catch(() => setHealth(null));
    api<{ connected: boolean }>("/payment-method").then((p) => setWallet(p.connected)).catch(() => {});
    Promise.all([api<any[]>("/orders?status=pending_approval"), api<any[]>("/orders?status=awaiting_payer")])
      .then(([a, b]) => setPending(a.length + b.length)).catch(() => {});
  }, [version, path]);

  const status = (
    <div className="rounded-2xl border border-line bg-white/80 p-3 text-xs">
      <div className="eyebrow mb-2">System</div>
      <div className="space-y-1.5 text-ink-2">
        <div className="flex items-center gap-2"><Dot on={health?.paypal === "sandbox"} />PayPal {health ? (health.paypal === "sandbox" ? "sandbox" : "mock mode") : "…"}</div>
        <div className="flex items-center gap-2"><Dot on={wallet} />{wallet ? "Wallet saved (Vault)" : "No wallet saved"}</div>
        <div className="flex items-center gap-2"><Dot on={!!health?.llm} /><span className="truncate">{health?.llm || "AI not configured"}</span></div>
        <div className="flex items-center gap-2"><Dot on={health?.catalog === "channel3"} />{health?.catalog === "channel3" ? "Channel3 search" : "Demo catalog"}</div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen flex-col gap-6 border-r border-line bg-canvas px-4 py-5 lg:flex">
        <div className="px-2"><Brand /></div>
        <NavLinks pending={pending} />
        <div className="mt-auto">{status}</div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-white/85 px-4 py-3 backdrop-blur lg:hidden">
        <Brand />
        <button className="btn-ghost h-9 w-9 px-0" aria-label="Open menu" onClick={() => setOpen(true)}><Menu className="h-4 w-4" /></button>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 animate-in flex-col gap-6 bg-canvas p-5 shadow-[var(--shadow-pop)]">
            <div className="flex items-center justify-between"><Brand /><button className="btn-ghost h-8 w-8 px-0" aria-label="Close menu" onClick={() => setOpen(false)}><X className="h-4 w-4" /></button></div>
            <NavLinks pending={pending} onNavigate={() => setOpen(false)} />
            <div className="mt-auto">{status}</div>
          </div>
        </div>
      )}

      <main className="min-w-0 px-4 py-6 sm:px-8 lg:py-10">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
