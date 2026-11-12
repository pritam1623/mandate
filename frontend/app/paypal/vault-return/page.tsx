"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api } from "@/lib/api";

function VaultReturn() {
  const params = useSearchParams();
  const router = useRouter();
  const [msg, setMsg] = useState("Saving your PayPal wallet…");

  useEffect(() => {
    const token = params.get("approval_token_id");
    if (!token) { setMsg("PayPal did not return a setup token."); return; }
    api("/payment-method/confirm", { method: "POST", body: JSON.stringify({ setup_token_id: token }) })
      .then(() => router.replace("/settings"))
      .catch((e) => setMsg(`Could not save the wallet: ${e.message}`));
  }, [params, router]);

  return <div className="card mx-auto mt-16 flex max-w-md items-center gap-3 p-6 text-sm"><span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-brand border-t-transparent" />{msg}</div>;
}

export default function Page() {
  return <Suspense><VaultReturn /></Suspense>;
}
