"use client";
/* Keeps the agent conversation alive while you move between pages.
   The request keeps running and its reply lands here even if the Agent page is closed. */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

export type Step = { tool: string; input: any; output: any };
export type Turn = { role: "user" | "assistant"; content: string; steps?: Step[] };

type Chat = {
  mandateId: string;
  setMandateId: (id: string) => void;
  turns: Turn[];
  busy: boolean;
  err: string;
  send: (msg: string) => Promise<void>;
  clear: () => void;
  version: number; // bumps after each reply so pages can refresh their data
};

const Ctx = createContext<Chat | null>(null);
const KEY = "mandate-chat-v1";

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [mandateId, setMid] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [version, setVersion] = useState(0);
  const sending = useRef(false);
  const loaded = useRef(false);

  // Restore after a page refresh (per browser tab only).
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(KEY) || "null");
      if (saved) { setMid(saved.mandateId || ""); setTurns(saved.turns || []); }
    } catch { /* storage unavailable: start fresh */ }
    loaded.current = true;
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    try { sessionStorage.setItem(KEY, JSON.stringify({ mandateId, turns })); } catch { /* ignore */ }
  }, [mandateId, turns]);

  const setMandateId = useCallback((id: string) => {
    setMid((cur) => { if (cur && cur !== id) setTurns([]); return id; });
  }, []);

  const send = useCallback(async (msg: string) => {
    if (!msg.trim() || !mandateId || sending.current) return;
    sending.current = true;
    setBusy(true);
    setErr("");
    const history = turns.map(({ role, content }) => ({ role, content }));
    setTurns((t) => [...t, { role: "user", content: msg }]);
    try {
      const r = await api<{ reply: string; steps: Step[] }>("/chat", {
        method: "POST",
        body: JSON.stringify({ mandate_id: mandateId, message: msg, history }),
      });
      setTurns((t) => [...t, { role: "assistant", content: r.reply, steps: r.steps }]);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      sending.current = false;
      setBusy(false);
      setVersion((v) => v + 1);
    }
  }, [mandateId, turns]);

  const clear = useCallback(() => { setTurns([]); setErr(""); }, []);

  return (
    <Ctx.Provider value={{ mandateId, setMandateId, turns, busy, err, send, clear, version }}>
      {children}
    </Ctx.Provider>
  );
}

export function useChat() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useChat must be used inside ChatProvider");
  return c;
}
