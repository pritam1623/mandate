from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def _id(prefix: str):
    return lambda: f"{prefix}_{uuid4().hex[:12]}"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Mandate(Base):
    """Spending rules the agent must stay inside."""

    __tablename__ = "mandates"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_id("mdt"))
    name: Mapped[str] = mapped_column(String)
    weekly_budget: Mapped[float] = mapped_column(Float)
    per_order_cap: Mapped[float] = mapped_column(Float)
    auto_approve_limit: Mapped[float] = mapped_column(Float)
    allowed_categories: Mapped[list] = mapped_column(JSON, default=list)  # empty = any
    allowed_merchants: Mapped[list] = mapped_column(JSON, default=list)  # empty = any
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PaymentMethod(Base):
    """A PayPal wallet saved through PayPal Vault, so the agent can pay without a popup."""

    __tablename__ = "payment_methods"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_id("pm"))
    setup_token_id: Mapped[str] = mapped_column(String)
    vault_id: Mapped[str | None] = mapped_column(String, nullable=True)  # PayPal payment token
    status: Mapped[str] = mapped_column(String, default="pending")  # pending | active
    payer_email: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_id("ord"))
    mandate_id: Mapped[str] = mapped_column(ForeignKey("mandates.id"))
    # awaiting_payer | pending_approval | captured | declined | voided | refunded | failed
    status: Mapped[str] = mapped_column(String)
    decision: Mapped[str] = mapped_column(String)  # allow | needs_approval | deny
    reasons: Mapped[list] = mapped_column(JSON, default=list)
    items: Mapped[list] = mapped_column(JSON, default=list)
    total: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String, default="USD")
    agent_reasoning: Mapped[str] = mapped_column(Text, default="")
    paypal_order_id: Mapped[str | None] = mapped_column(String, nullable=True)
    paypal_authorization_id: Mapped[str | None] = mapped_column(String, nullable=True)
    paypal_capture_id: Mapped[str | None] = mapped_column(String, nullable=True)
    paypal_refund_id: Mapped[str | None] = mapped_column(String, nullable=True)
    approve_url: Mapped[str | None] = mapped_column(String, nullable=True)  # no-vault path only
    refund_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class AuditEvent(Base):
    """Every agent step and every money movement, with the reason behind it."""

    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_id("evt"))
    kind: Mapped[str] = mapped_column(String)  # agent_tool | policy | paypal | webhook | user
    message: Mapped[str] = mapped_column(Text)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    order_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
