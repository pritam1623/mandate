"""Business operations shared by the API routes and the agent's tools.

Rule of the house: money only moves here, and only after policy.evaluate() says so.
"""
from __future__ import annotations

import uuid
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import catalog
from .config import get_settings
from .models import AuditEvent, Mandate, Order, PaymentMethod, utcnow
from .paypal import PayPalClient, PayPalError
from .policy import CartItem, Decision, Rules, evaluate

HOLDS_BUDGET = ("captured", "pending_approval", "awaiting_payer")
DUPLICATE_WINDOW = timedelta(minutes=10)


class ServiceError(ValueError):
    pass


def audit(db: Session, kind: str, message: str, data: dict | None = None, order_id: str | None = None) -> None:
    db.add(AuditEvent(kind=kind, message=message, data=data or {}, order_id=order_id))
    db.commit()


def rules_of(m: Mandate) -> Rules:
    return Rules(
        weekly_budget=m.weekly_budget,
        per_order_cap=m.per_order_cap,
        auto_approve_limit=m.auto_approve_limit,
        allowed_categories=list(m.allowed_categories or []),
        allowed_merchants=list(m.allowed_merchants or []),
        expires_at=m.expires_at,
        active=m.active,
    )


def spent_this_week(db: Session, mandate_id: str) -> float:
    since = utcnow() - timedelta(days=7)
    rows = db.scalars(
        select(Order).where(Order.mandate_id == mandate_id, Order.status.in_(HOLDS_BUDGET))
    ).all()
    return round(sum(o.total for o in rows if _aware(o.created_at) >= since), 2)


def _aware(dt):
    from datetime import timezone

    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def build_cart(lines: list[dict]) -> list[CartItem]:
    """lines: [{product_id, quantity}]. Prices come from the catalog cache only."""
    items = []
    for line in lines:
        p = catalog.get_product(str(line.get("product_id", "")))
        if p is None:
            raise ServiceError(f"Unknown product id '{line.get('product_id')}'. Search for products first.")
        qty = int(line.get("quantity", 1))
        items.append(CartItem(p["id"], p["title"], p["category"], p["merchant"], float(p["price"]), qty))
    return items


def check(db: Session, mandate: Mandate, items: list[CartItem]) -> Decision:
    return evaluate(items, rules_of(mandate), spent_this_week(db, mandate.id))


def find_duplicate(db: Session, mandate_id: str, items: list[CartItem]) -> Order | None:
    """Find a recent order under the same mandate with an identical cart."""
    wanted = sorted((i.product_id, i.quantity) for i in items)
    since = utcnow() - DUPLICATE_WINDOW
    rows = db.scalars(
        select(Order).where(Order.mandate_id == mandate_id, Order.status.in_(HOLDS_BUDGET))
    ).all()
    for o in rows:
        if _aware(o.created_at) < since:
            continue
        cart = sorted((i["product_id"], i["quantity"]) for i in o.items)
        if cart == wanted:
            return o
    return None


def active_payment_method(db: Session) -> PaymentMethod | None:
    return db.scalars(
        select(PaymentMethod).where(PaymentMethod.status == "active").order_by(PaymentMethod.created_at.desc())
    ).first()


def _items_json(items: list[CartItem]) -> list[dict]:
    return [
        {"product_id": i.product_id, "title": i.title, "category": i.category, "merchant": i.merchant,
         "unit_price": i.unit_price, "quantity": i.quantity, "line_total": i.line_total}
        for i in items
    ]


def place_order(
    db: Session, pp: PayPalClient, mandate: Mandate, items: list[CartItem], reasoning: str,
    allow_repeat: bool = False,
) -> Order:
    decision = check(db, mandate, items)
    if not allow_repeat and decision.outcome != "deny":
        dup = find_duplicate(db, mandate.id, items)
        if dup is not None:
            decision = Decision(
                "deny", decision.total,
                [f"Duplicate protection: the same cart was already bought in order {dup.id} a few minutes ago. "
                 "Ask the owner to confirm before buying it again."],
                decision.budget_remaining,
            )
    s = get_settings()
    order = Order(
        mandate_id=mandate.id,
        status="declined",
        decision=decision.outcome,
        reasons=decision.reasons,
        items=_items_json(items),
        total=decision.total,
        currency=s.currency,
        agent_reasoning=reasoning,
    )
    db.add(order)
    db.commit()
    audit(db, "policy", f"Mandate check: {decision.outcome}", {"reasons": decision.reasons, "total": decision.total}, order.id)

    if decision.outcome == "deny":
        return order

    # Authorize first: the money is held, not taken, until the rules (or the owner) say yes.
    pm = active_payment_method(db)
    try:
        auth = pp.create_authorized_order(
            items=order.items,
            currency=order.currency,
            reference_id=order.id,
            description=f"Mandate '{mandate.name}' purchase",
            vault_id=pm.vault_id if pm else None,
            request_id=f"{order.id}-create",
            return_url=f"{s.frontend_url}/paypal/return?order={order.id}",
            cancel_url=f"{s.frontend_url}/orders?cancelled={order.id}",
        )
    except PayPalError as e:
        order.status = "failed"
        db.commit()
        audit(db, "paypal", f"PayPal order failed: {e}", e.details, order.id)
        return order

    order.paypal_order_id = auth.order_id
    audit(db, "paypal", f"PayPal order {auth.order_id} created ({auth.status})", {}, order.id)

    if not auth.authorization_id:
        order.status = "awaiting_payer"
        order.approve_url = auth.approve_url
        db.commit()
        return order

    order.paypal_authorization_id = auth.authorization_id
    db.commit()
    _after_authorization(db, pp, order)
    return order


def _after_authorization(db: Session, pp: PayPalClient, order: Order) -> None:
    if order.decision == "allow":
        _capture(db, pp, order, "Auto-approved by mandate")
    else:
        order.status = "pending_approval"
        db.commit()
        audit(db, "policy", "Funds authorized and held; waiting for owner approval", {}, order.id)


def complete_payer_approval(db: Session, pp: PayPalClient, order: Order) -> Order:
    """Buyer came back from the PayPal approve page (no-vault path)."""
    if order.status != "awaiting_payer":
        raise ServiceError(f"Order is {order.status}, not awaiting the payer.")
    order.paypal_authorization_id = pp.authorize_order(order.paypal_order_id, f"{order.id}-authorize")
    db.commit()
    audit(db, "paypal", f"Authorization {order.paypal_authorization_id} created", {}, order.id)
    _after_authorization(db, pp, order)
    return order


def _capture(db: Session, pp: PayPalClient, order: Order, why: str) -> None:
    try:
        order.paypal_capture_id = pp.capture_authorization(order.paypal_authorization_id, f"{order.id}-capture")
        order.status = "captured"
        db.commit()
        audit(db, "paypal", f"Captured {order.total:.2f} {order.currency}. {why}", {"capture_id": order.paypal_capture_id}, order.id)
    except PayPalError as e:
        order.status = "failed"
        db.commit()
        audit(db, "paypal", f"Capture failed: {e}", e.details, order.id)


def approve(db: Session, pp: PayPalClient, order: Order) -> Order:
    if order.status != "pending_approval":
        raise ServiceError(f"Order is {order.status}, not waiting for approval.")
    audit(db, "user", "Owner approved the order", {}, order.id)
    _capture(db, pp, order, "Approved by owner")
    return order


def reject(db: Session, pp: PayPalClient, order: Order) -> Order:
    if order.status not in ("pending_approval", "awaiting_payer"):
        raise ServiceError(f"Order is {order.status}; only held orders can be rejected.")
    if order.paypal_authorization_id:
        pp.void_authorization(order.paypal_authorization_id)
    order.status = "voided"
    db.commit()
    audit(db, "user", "Owner rejected the order; the authorization was voided and funds released", {}, order.id)
    return order


def refund(db: Session, pp: PayPalClient, order: Order, reason: str) -> Order:
    if order.status != "captured" or not order.paypal_capture_id:
        raise ServiceError(f"Order is {order.status}; only captured orders can be refunded.")
    order.paypal_refund_id = pp.refund_capture(
        order.paypal_capture_id, note=reason, request_id=f"{order.id}-refund-{uuid.uuid4().hex[:6]}",
        currency=order.currency,
    )
    order.status = "refunded"
    order.refund_reason = reason
    db.commit()
    audit(db, "paypal", f"Refunded {order.total:.2f} {order.currency}: {reason}", {"refund_id": order.paypal_refund_id}, order.id)
    return order
