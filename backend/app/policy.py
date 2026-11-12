"""Policy engine: decides in code, never in the prompt, whether a cart can be paid.

evaluate() is a pure function so it is easy to unit-test and easy to explain to judges.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal

Outcome = Literal["allow", "needs_approval", "deny"]


@dataclass(frozen=True)
class CartItem:
    product_id: str
    title: str
    category: str
    merchant: str
    unit_price: float
    quantity: int = 1

    @property
    def line_total(self) -> float:
        return round(self.unit_price * self.quantity, 2)


@dataclass(frozen=True)
class Rules:
    weekly_budget: float
    per_order_cap: float
    auto_approve_limit: float
    allowed_categories: list[str] = field(default_factory=list)
    allowed_merchants: list[str] = field(default_factory=list)
    expires_at: datetime | None = None
    active: bool = True


@dataclass(frozen=True)
class Decision:
    outcome: Outcome
    total: float
    reasons: list[str]
    budget_remaining: float


def _norm(s: str) -> str:
    return s.strip().lower()


def evaluate(
    items: list[CartItem],
    rules: Rules,
    spent_this_week: float,
    now: datetime | None = None,
) -> Decision:
    now = now or datetime.now(timezone.utc)
    total = round(sum(i.line_total for i in items), 2)
    remaining = round(rules.weekly_budget - spent_this_week, 2)
    hard: list[str] = []

    if not items:
        hard.append("Cart is empty.")
    if any(i.quantity < 1 or i.unit_price < 0 for i in items):
        hard.append("Cart has an invalid quantity or price.")
    if not rules.active:
        hard.append("Mandate is paused.")
    if rules.expires_at is not None:
        exp = rules.expires_at if rules.expires_at.tzinfo else rules.expires_at.replace(tzinfo=timezone.utc)
        if now >= exp:
            hard.append(f"Mandate expired on {exp.date().isoformat()}.")

    if rules.allowed_categories:
        allowed = {_norm(c) for c in rules.allowed_categories}
        for i in items:
            if _norm(i.category) not in allowed:
                hard.append(f"'{i.title}' is in category '{i.category}', which this mandate does not allow.")

    if rules.allowed_merchants:
        allowed = {_norm(m) for m in rules.allowed_merchants}
        for i in items:
            if _norm(i.merchant) not in allowed:
                hard.append(f"Merchant '{i.merchant}' is not on the allowed list.")

    if total > rules.per_order_cap:
        hard.append(f"Order total {total:.2f} is over the per-order cap of {rules.per_order_cap:.2f}.")
    if total > remaining:
        hard.append(f"Order total {total:.2f} is over the {remaining:.2f} left in this week's budget.")

    if hard:
        return Decision("deny", total, hard, remaining)

    if total > rules.auto_approve_limit:
        return Decision(
            "needs_approval",
            total,
            [f"Order total {total:.2f} is over the auto-approve limit of {rules.auto_approve_limit:.2f}; the owner must approve."],
            remaining,
        )

    return Decision(
        "allow",
        total,
        [f"Within all rules: {total:.2f} is under the auto-approve limit of {rules.auto_approve_limit:.2f}."],
        remaining,
    )
