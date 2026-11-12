import { Ban, CheckCircle2, Clock, Hourglass, RotateCcw, XCircle, type LucideIcon } from "lucide-react";

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

const STATUS: Record<string, { label: string; cls: string; icon: LucideIcon }> = {
  captured: { label: "Paid", cls: "bg-ok-soft text-ok ring-emerald-200", icon: CheckCircle2 },
  pending_approval: { label: "Needs approval", cls: "bg-warn-soft text-warn ring-amber-200", icon: Clock },
  awaiting_payer: { label: "Awaiting PayPal", cls: "bg-warn-soft text-warn ring-amber-200", icon: Hourglass },
  declined: { label: "Blocked", cls: "bg-bad-soft text-bad ring-red-200", icon: Ban },
  voided: { label: "Rejected", cls: "bg-slate-100 text-slate-600 ring-slate-200", icon: XCircle },
  refunded: { label: "Refunded", cls: "bg-info-soft text-info ring-violet-200", icon: RotateCcw },
  failed: { label: "Failed", cls: "bg-bad-soft text-bad ring-red-200", icon: XCircle },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] || { label: status, cls: "bg-slate-100 text-slate-600 ring-slate-200", icon: Clock };
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${s.cls}`}>
      <Icon className="h-3 w-3" strokeWidth={2.5} />
      {s.label}
    </span>
  );
}

export function Meter({ value, max, className = "" }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const color = pct > 90 ? "bg-bad" : pct > 70 ? "bg-amber-500" : "bg-brand";
  return (
    <div className={`h-2 overflow-hidden rounded-full bg-line-2 ${className}`} role="meter" aria-valuenow={value} aria-valuemax={max}>
      <div className={`h-full rounded-full ${color} transition-[width] duration-700`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Empty({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-12 text-center">
      <div className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-soft text-brand"><Icon className="h-5 w-5" /></div>
      <div className="mt-3 font-medium">{title}</div>
      {body && <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-line-2 ${className}`} />;
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-red-200 bg-bad-soft px-4 py-3 text-sm text-bad">{children}</div>;
}

export function Chip({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "brand" }) {
  const cls = tone === "brand" ? "bg-brand-soft text-brand" : "bg-line-2 text-ink-2";
  return <span className={`inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}
