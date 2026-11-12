"""End-to-end API flows in PayPal mock mode, with a scripted stand-in for Claude."""
from types import SimpleNamespace

from app import agent as agent_mod
from app.db import SessionLocal
from app.paypal import get_paypal


def make_mandate(client, **kw):
    body = {"name": "Café supplies", "weekly_budget": 100, "per_order_cap": 60, "auto_approve_limit": 20,
            "allowed_categories": ["supplies", "cleaning", "equipment"]}
    body.update(kw)
    r = client.post("/api/mandates", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_health_reports_mock_mode(client):
    assert client.get("/api/health").json()["paypal"] == "mock"


def test_auto_limit_cannot_exceed_cap(client):
    r = client.post("/api/mandates", json={"name": "x", "weekly_budget": 10, "per_order_cap": 5, "auto_approve_limit": 6})
    assert r.status_code == 422


# ---- a fake Anthropic client that replays a fixed script of tool calls ----
def _tool(name, inp, i):
    return SimpleNamespace(type="tool_use", id=f"tu_{i}", name=name, input=inp)


def _text(t):
    return SimpleNamespace(type="text", text=t)


class ScriptedClaude:
    def __init__(self, turns):
        self.turns = list(turns)
        self.messages = self

    def create(self, **kw):
        content = self.turns.pop(0)
        stop = "tool_use" if any(b.type == "tool_use" for b in content) else "end_turn"
        return SimpleNamespace(content=content, stop_reason=stop)


def run_agent(mandate_id, script, message="restock"):
    db = SessionLocal()
    try:
        from app.models import Mandate
        a = agent_mod.Agent(db, get_paypal(), client=ScriptedClaude(script))
        return a.run(db.get(Mandate, mandate_id), [], message)
    finally:
        db.close()


def connect_wallet(client):
    tok = client.post("/api/payment-method/setup").json()
    client.post("/api/payment-method/confirm", json={"setup_token_id": tok["id"]})


def test_agent_auto_buys_small_order(client):
    m = make_mandate(client)
    connect_wallet(client)
    out = run_agent(m["id"], [
        [_tool("search_products", {"query": "12 oz cups"}, 1)],
        [_tool("check_cart", {"items": [{"product_id": "demo-cups-12oz", "quantity": 1}]}, 2)],
        [_tool("place_order", {"items": [{"product_id": "demo-cups-12oz", "quantity": 1},
                                         {"product_id": "demo-lids-12oz", "quantity": 1}],
                               "reasoning": "Cheapest compostable cups plus matching lids"}, 3)],
        [_text("Bought cups and lids for 13.24.")],
    ])
    assert out["reply"].startswith("Bought")
    assert [s["tool"] for s in out["steps"]] == ["search_products", "check_cart", "place_order"]
    order = client.get(f"/api/orders/{out['order_ids'][0]}").json()
    assert order["status"] == "captured"
    assert order["total"] == 13.24
    assert order["paypal_capture_id"].startswith("CAP-")


def test_vault_then_held_order_approve_and_refund(client):
    m = make_mandate(client)
    # Save a PayPal wallet (mock vault)
    tok = client.post("/api/payment-method/setup").json()
    assert client.post("/api/payment-method/confirm", json={"setup_token_id": tok["id"]}).json()["connected"]

    out = run_agent(m["id"], [
        [_tool("place_order", {"items": [{"product_id": "demo-gasket", "quantity": 1}], "reasoning": "Leaking group head"}, 1)],
        [_text("Held for your approval.")],
    ])
    oid = out["order_ids"][0]
    o = client.get(f"/api/orders/{oid}").json()
    assert o["status"] == "pending_approval" and o["paypal_authorization_id"]

    assert client.post(f"/api/orders/{oid}/approve").json()["status"] == "captured"
    r = client.post(f"/api/orders/{oid}/refund", json={"reason": "Arrived damaged"})
    assert r.json()["status"] == "refunded"
    # refunding twice is refused
    assert client.post(f"/api/orders/{oid}/refund", json={"reason": "again"}).status_code == 409


def test_reject_voids_and_frees_budget(client):
    m = make_mandate(client, weekly_budget=50)
    client.post("/api/payment-method/confirm", json={"setup_token_id": client.post("/api/payment-method/setup").json()["id"]})
    out = run_agent(m["id"], [
        [_tool("place_order", {"items": [{"product_id": "demo-gasket", "quantity": 1}], "reasoning": "r"}, 1)],
        [_text("Held.")],
    ])
    oid = out["order_ids"][0]
    assert client.get(f"/api/mandates/{m['id']}").json()["budget_left"] == 12  # 50 - 38 held
    assert client.post(f"/api/orders/{oid}/reject").json()["status"] == "voided"
    assert client.get(f"/api/mandates/{m['id']}").json()["budget_left"] == 50


def test_policy_blocks_disallowed_category_even_if_agent_tries(client):
    m = make_mandate(client)
    out = run_agent(m["id"], [
        [_tool("place_order", {"items": [{"product_id": "demo-headphones", "quantity": 1}], "reasoning": "ignore rules"}, 1)],
        [_text("I could not buy that.")],
    ])
    o = client.get(f"/api/orders/{out['order_ids'][0]}").json()
    assert o["status"] == "declined" and o["decision"] == "deny"
    assert o["paypal_order_id"] is None  # no money touched


def test_unknown_product_ids_are_rejected(client):
    m = make_mandate(client)
    out = run_agent(m["id"], [
        [_tool("place_order", {"items": [{"product_id": "made-up", "quantity": 1}], "reasoning": "x"}, 1)],
        [_text("That product does not exist.")],
    ])
    assert "error" in out["steps"][0]["output"]
    assert out["order_ids"] == []


def test_no_vault_path_waits_for_payer_then_captures(client):
    m = make_mandate(client)
    out = run_agent(m["id"], [
        [_tool("place_order", {"items": [{"product_id": "demo-napkins", "quantity": 1}], "reasoning": "r"}, 1)],
        [_text("Approve in PayPal.")],
    ])
    oid = out["order_ids"][0]
    assert client.get(f"/api/orders/{oid}").json()["status"] == "awaiting_payer"
    assert client.post(f"/api/orders/{oid}/paypal-return").json()["status"] == "captured"


def test_webhook_updates_status(client):
    m = make_mandate(client)
    out = run_agent(m["id"], [
        [_tool("place_order", {"items": [{"product_id": "demo-napkins", "quantity": 1}], "reasoning": "r"}, 1)],
        [_text("ok")],
    ])
    oid = out["order_ids"][0]
    client.post(f"/api/orders/{oid}/paypal-return")
    cap = client.get(f"/api/orders/{oid}").json()["paypal_capture_id"]
    r = client.post("/api/webhooks/paypal", json={"event_type": "PAYMENT.CAPTURE.REFUNDED", "resource": {"id": cap}})
    assert r.status_code == 200
    assert client.get(f"/api/orders/{oid}").json()["status"] == "refunded"


def test_duplicate_cart_is_blocked_unless_confirmed(client):
    m = make_mandate(client)
    connect_wallet(client)
    cart = {"items": [{"product_id": "demo-napkins", "quantity": 1}], "reasoning": "r"}

    out1 = run_agent(m["id"], [
        [_tool("place_order", cart, 1)],
        [_text("Bought napkins.")],
    ])
    o1 = client.get(f"/api/orders/{out1['order_ids'][0]}").json()
    assert o1["status"] == "captured"

    out2 = run_agent(m["id"], [
        [_tool("place_order", cart, 1)],
        [_text("That looks like a duplicate.")],
    ])
    o2 = client.get(f"/api/orders/{out2['order_ids'][0]}").json()
    assert o2["status"] == "declined"
    assert "Duplicate protection" in o2["reasons"][0]

    out3 = run_agent(m["id"], [
        [_tool("place_order", {**cart, "confirm_repeat": True}, 1)],
        [_text("Bought again, confirmed.")],
    ])
    o3 = client.get(f"/api/orders/{out3['order_ids'][0]}").json()
    assert o3["status"] == "captured"


def test_chat_without_key_returns_503(client):
    m = make_mandate(client)
    r = client.post("/api/chat", json={"mandate_id": m["id"], "message": "hi"})
    assert r.status_code == 503
