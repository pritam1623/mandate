"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api } from "@/lib/api";

function OrderReturn() {
  const params = useSearchParams();
  const router = useRouter();
  const [msg, setMsg] = useState("Confirming with PayPal…");

  useEffect(() => {
    const order = params.get("order");
    if (!order) { setMsg("Missing order reference."); return; }
    api(`/orders/${order}/paypal-return`, { method: "POST" })
      .then(() => router.replace(`/orders/${order}`))
      .catch((e) => setMsg(`PayPal step failed: ${e.message}`));
  }, [params, router]);

  return <div className="card mx-auto mt-16 flex max-w-md items-center gap-3 p-6 text-sm"><span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-brand border-t-transparent" />{msg}</div>;
}

export default function Page() {
  return <Suspense><OrderReturn /></Suspense>;
}
