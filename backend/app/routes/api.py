from __future__ import annotations

import threading
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import services
from ..agent import Agent, _order_view
from ..config import get_settings
from ..db import get_db
from ..models import AuditEvent, Mandate, Order, PaymentMethod
from ..paypal import PayPalClient, PayPalError, get_paypal

router = APIRouter(prefix="/api")


# ---------- schemas ----------
class MandateIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    weekly_budget: float = Field(gt=0)
    per_order_cap: float = Field(gt=0)
    auto_approve_limit: float = Field(ge=0)
    allowed_categories: list[str] = []
    allowed_merchants: list[str] = []
    expires_at: datetime | None = None
    active: bool = True


class MandatePatch(BaseModel):
    name: str | None = None
    weekly_budget: float | None = Field(default=None, gt=0)
    per_order_cap: float | None = Field(default=None, gt=0)
    auto_approve_limit: float | None = Field(default=None, ge=0)
    allowed_categories: list[str] | None = None
    allowed_merchants: list[str] | None = None
    expires_at: datetime | None = None
    active: bool | None = None


class ChatTurn(BaseModel):
    role: str
    content: str


class ChatIn(BaseModel):
    mandate_id: str
    message: str = Field(min_length=1, max_length=2000)
    history: list[ChatTurn] = []


class RefundIn(BaseModel):
    reason: str = Field(min_length=3, max_length=255)


class ConfirmVaultIn(BaseModel):
    setup_token_id: str


# ---------- helpers ----------
def _mandate_view(db: Session, m: Mandate) -> dict:
    spent = services.spent_this_week(db, m.id)
    return {
        "id": m.id, "name": m.name, "weekly_budget": m.weekly_budget, "per_order_cap": m.per_order_cap,
        "auto_approve_limit": m.auto_approve_limit, "allowed_categories": m.allowed_categories,
        "allowed_merchants": m.allowed_merchants, "expires_at": m.expires_at, "active": m.active,
        "spent_this_week": spent, "budget_left": round(m.weekly_budget - spent, 2),
    }


def _order_full(o: Order) -> dict:
    return {
        **_order_view(o), "mandate_id": o.mandate_id, "items": o.items, "agent_reasoning": o.agent_reasoning,
        "paypal_order_id": o.paypal_order_id, "paypal_authorization_id": o.paypal_authorization_id,
        "paypal_capture_id": o.paypal_capture_id, "paypal_refund_id": o.paypal_refund_id,
        "refund_reason": o.refund_reason, "created_at": o.created_at,
    }


def _event_view(e: AuditEvent) -> dict:
    return {"id": e.id, "kind": e.kind, "message": e.message, "data": e.data, "order_id": e.order_id,
            "created_at": e.created_at}


def _get_mandate(db: Session, mid: str) -> Mandate:
    m = db.get(Mandate, mid)
    if m is None:
        raise HTTPException(404, "Mandate not found")
    return m


def _get_order(db: Session, oid: str) -> Order:
    o = db.get(Order, oid)
    if o is None:
        raise HTTPException(404, "Order not found")
    return o


def _service_call(fn, *args):
    try:
        return fn(*args)
    except services.ServiceError as e:
        raise HTTPException(409, str(e))
    except PayPalError as e:
        raise HTTPException(502, str(e))


# ---------- status ----------
@router.get("/health")
def health():
    s = get_settings()
    return {
        "ok": True,
        "paypal": "mock" if s.paypal_mock else "sandbox",
        "catalog": "channel3" if s.channel3_api_key else "demo",
        "llm": s.anthropic_model if s.anthropic_api_key else None,
    }


# ---------- mandates ----------
@router.get("/mandates")
def list_mandates(db: Session = Depends(get_db)):
    rows = db.scalars(select(Mandate).order_by(Mandate.created_at)).all()
    return [_mandate_view(db, m) for m in rows]


@router.post("/mandates", status_code=201)
def create_mandate(body: MandateIn, db: Session = Depends(get_db)):
    if body.auto_approve_limit > body.per_order_cap:
        raise HTTPException(422, "Auto-approve limit cannot be above the per-order cap")
    m = Mandate(**body.model_dump())
    db.add(m)
    db.commit()
    services.audit(db, "user", f"Mandate '{m.name}' created", body.model_dump(mode="json"))
    return _mandate_view(db, m)


@router.get("/mandates/{mid}")
def get_mandate(mid: str, db: Session = Depends(get_db)):
    return _mandate_view(db, _get_mandate(db, mid))


@router.patch("/mandates/{mid}")
def update_mandate(mid: str, body: MandatePatch, db: Session = Depends(get_db)):
    m = _get_mandate(db, mid)
    changes = body.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(m, k, v)
    if m.auto_approve_limit > m.per_order_cap:
        db.rollback()
        raise HTTPException(422, "Auto-approve limit cannot be above the per-order cap")
    db.commit()
    services.audit(db, "user", f"Mandate '{m.name}' updated", body.model_dump(mode="json", exclude_unset=True))
    return _mandate_view(db, m)


# ---------- agent ----------
@router.post("/chat")
def chat(body: ChatIn, db: Session = Depends(get_db), pp: PayPalClient = Depends(get_paypal)):
    m = _get_mandate(db, body.mandate_id)
    try:
        agent = Agent(db, pp)
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    return agent.run(m, [t.model_dump() for t in body.history], body.message)


# ---------- orders ----------
@router.get("/orders")
def list_orders(status: str | None = None, db: Session = Depends(get_db)):
    q = select(Order).order_by(Order.created_at.desc())
    if status:
        q = q.where(Order.status == status)
    return [_order_full(o) for o in db.scalars(q).all()]


@router.get("/orders/{oid}")
def get_order(oid: str, db: Session = Depends(get_db)):
    o = _get_order(db, oid)
    events = db.scalars(select(AuditEvent).where(AuditEvent.order_id == oid).order_by(AuditEvent.created_at)).all()
    return {**_order_full(o), "events": [_event_view(e) for e in events]}


@router.post("/orders/{oid}/approve")
def approve_order(oid: str, db: Session = Depends(get_db), pp: PayPalClient = Depends(get_paypal)):
    return _order_full(_service_call(services.approve, db, pp, _get_order(db, oid)))


@router.post("/orders/{oid}/reject")
def reject_order(oid: str, db: Session = Depends(get_db), pp: PayPalClient = Depends(get_paypal)):
    return _order_full(_service_call(services.reject, db, pp, _get_order(db, oid)))


@router.post("/orders/{oid}/refund")
def refund_order(oid: str, body: RefundIn, db: Session = Depends(get_db), pp: PayPalClient = Depends(get_paypal)):
    return _order_full(_service_call(services.refund, db, pp, _get_order(db, oid), body.reason))


@router.post("/orders/{oid}/paypal-return")
def paypal_return(oid: str, db: Session = Depends(get_db), pp: PayPalClient = Depends(get_paypal)):
    return _order_full(_service_call(services.complete_payer_approval, db, pp, _get_order(db, oid)))


# ---------- payment method (PayPal Vault) ----------
@router.get("/payment-method")
def current_payment_method(db: Session = Depends(get_db)):
    pm = services.active_payment_method(db)
    return {"connected": bool(pm), "payer_email": pm.payer_email if pm else None}


@router.post("/payment-method/setup")
def setup_payment_method(db: Session = Depends(get_db), pp: PayPalClient = Depends(get_paypal)):
    s = get_settings()
    try:
        tok = pp.create_setup_token(f"{s.frontend_url}/paypal/vault-return", f"{s.frontend_url}/settings")
    except PayPalError as e:
        raise HTTPException(502, str(e))
    db.add(PaymentMethod(setup_token_id=tok["id"]))
    db.commit()
    return tok


@router.post("/payment-method/confirm")
def confirm_payment_method(body: ConfirmVaultIn, db: Session = Depends(get_db), pp: PayPalClient = Depends(get_paypal)):
    pm = db.scalars(select(PaymentMethod).where(PaymentMethod.setup_token_id == body.setup_token_id)).first()
    if pm is None:
        raise HTTPException(404, "Unknown setup token")
    try:
        tok = pp.create_payment_token(body.setup_token_id)
    except PayPalError as e:
        raise HTTPException(502, str(e))
    pm.vault_id, pm.payer_email, pm.status = tok["id"], tok.get("payer_email"), "active"
    db.commit()
    services.audit(db, "paypal", "PayPal wallet saved for agent payments (Vault)", {"payer_email": pm.payer_email})
    return {"connected": True, "payer_email": pm.payer_email}


# ---------- webhooks ----------
WEBHOOK_STATUS = {
    "PAYMENT.CAPTURE.COMPLETED": "captured",
    "PAYMENT.CAPTURE.REFUNDED": "refunded",
    "PAYMENT.AUTHORIZATION.VOIDED": "voided",
    "PAYMENT.CAPTURE.DENIED": "failed",
}


@router.post("/webhooks/paypal")
async def paypal_webhook(request: Request, db: Session = Depends(get_db), pp: PayPalClient = Depends(get_paypal)):
    event = await request.json()
    if not pp.verify_webhook(dict(request.headers), event):
        raise HTTPException(400, "Webhook signature did not verify")
    etype = event.get("event_type", "")
    res = event.get("resource", {})
    # Find our order by any PayPal id the event carries.
    ids = {res.get("id"), res.get("supplementary_data", {}).get("related_ids", {}).get("order_id"),
           res.get("supplementary_data", {}).get("related_ids", {}).get("authorization_id")} - {None}
    order = None
    for col in (Order.paypal_capture_id, Order.paypal_authorization_id, Order.paypal_order_id, Order.paypal_refund_id):
        order = db.scalars(select(Order).where(col.in_(ids))).first()
        if order:
            break
    if order and etype in WEBHOOK_STATUS:
        order.status = WEBHOOK_STATUS[etype]
        db.commit()
    services.audit(db, "webhook", f"PayPal event {etype}", {"resource_id": res.get("id")}, order.id if order else None)
    return {"received": True}


# ---------- dashboard ----------
@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db)):
    mandates = [_mandate_view(db, m) for m in db.scalars(select(Mandate)).all()]
    orders = db.scalars(select(Order)).all()
    events = db.scalars(select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(25)).all()
    by_status: dict[str, int] = {}
    for o in orders:
        by_status[o.status] = by_status.get(o.status, 0) + 1
    return {
        "mandates": mandates,
        "orders_by_status": by_status,
        "total_captured": round(sum(o.total for o in orders if o.status == "captured"), 2),
        "total_refunded": round(sum(o.total for o in orders if o.status == "refunded"), 2),
        "pending_approvals": by_status.get("pending_approval", 0),
        "blocked_by_policy": by_status.get("declined", 0),
        "recent_events": [_event_view(e) for e in events],
    }


@router.get("/audit")
def audit_log(limit: int = 100, db: Session = Depends(get_db)):
    rows = db.scalars(select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(min(limit, 500))).all()
    return [_event_view(e) for e in rows]


_seed_lock = threading.Lock()


@router.post("/demo/seed")
def seed(db: Session = Depends(get_db)):
    """Create the demo mandate from the pitch if no mandates exist yet.
    The lock stops two page loads at the same moment from seeding twice."""
    with _seed_lock:
        return _seed(db)


def _seed(db: Session):
    if db.scalars(select(Mandate)).first():
        return {"seeded": False}
    m = Mandate(name="Café supplies", weekly_budget=150, per_order_cap=80, auto_approve_limit=25,
                allowed_categories=["supplies", "cleaning", "pantry", "coffee", "equipment"], allowed_merchants=[])
    db.add(m)
    db.commit()
    services.audit(db, "user", "Demo mandate 'Café supplies' created", {})
    return {"seeded": True, "mandate_id": m.id}
