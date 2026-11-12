export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.detail ? String(typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail)) : `Request failed (${res.status})`);
  return body as T;
}

export type Mandate = {
  id: string;
  name: string;
  weekly_budget: number;
  per_order_cap: number;
  auto_approve_limit: number;
  allowed_categories: string[];
  allowed_merchants: string[];
  expires_at: string | null;
  active: boolean;
  spent_this_week: number;
  budget_left: number;
};

export type OrderItem = { product_id?: string; title: string; quantity: number; unit_price?: number; line_total?: number; merchant?: string; category?: string };

export type Order = {
  id: string;
  status: string;
  decision: string;
  total: number;
  currency: string;
  reasons: string[];
  items: OrderItem[];
  approve_url: string | null;
  mandate_id?: string;
  agent_reasoning?: string;
  paypal_order_id?: string | null;
  paypal_authorization_id?: string | null;
  paypal_capture_id?: string | null;
  paypal_refund_id?: string | null;
  refund_reason?: string | null;
  created_at?: string;
};

export type AuditEvent = { id: string; kind: string; message: string; data: any; order_id: string | null; created_at: string };

export const money = (n: number, c = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: c }).format(n ?? 0);

export const when = (s?: string) => (s ? new Date(s.endsWith("Z") || s.includes("+") ? s : s + "Z").toLocaleString() : "");

const toDate = (s: string) => new Date(s.endsWith("Z") || s.includes("+") ? s : s + "Z");

export function ago(s: string) {
  const d = Math.max(0, (Date.now() - toDate(s).getTime()) / 1000);
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}
