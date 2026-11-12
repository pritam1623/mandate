from datetime import datetime, timedelta, timezone

from app.policy import CartItem, Rules, evaluate

NOW = datetime(2026, 11, 5, tzinfo=timezone.utc)
RULES = Rules(
    weekly_budget=100,
    per_order_cap=60,
    auto_approve_limit=20,
    allowed_categories=["supplies", "cleaning"],
    allowed_merchants=[],
)


def item(price, qty=1, category="supplies", merchant="CafeSupplyCo"):
    return CartItem("p1", "Paper cups", category, merchant, price, qty)


def test_small_order_is_auto_approved():
    d = evaluate([item(5, 3)], RULES, spent_this_week=0, now=NOW)
    assert d.outcome == "allow"
    assert d.total == 15


def test_over_auto_limit_needs_approval():
    d = evaluate([item(30)], RULES, spent_this_week=0, now=NOW)
    assert d.outcome == "needs_approval"


def test_exactly_at_limit_is_allowed():
    assert evaluate([item(20)], RULES, 0, NOW).outcome == "allow"


def test_over_per_order_cap_is_denied():
    d = evaluate([item(61)], RULES, 0, NOW)
    assert d.outcome == "deny"
    assert any("per-order cap" in r for r in d.reasons)


def test_weekly_budget_is_enforced():
    d = evaluate([item(15)], RULES, spent_this_week=90, now=NOW)
    assert d.outcome == "deny"
    assert d.budget_remaining == 10


def test_disallowed_category_is_denied():
    d = evaluate([item(5, category="electronics")], RULES, 0, NOW)
    assert d.outcome == "deny"
    assert "electronics" in d.reasons[0]


def test_category_match_ignores_case():
    assert evaluate([item(5, category=" Supplies ")], RULES, 0, NOW).outcome == "allow"


def test_merchant_allow_list():
    rules = Rules(100, 60, 20, [], ["CafeSupplyCo"])
    assert evaluate([item(5)], rules, 0, NOW).outcome == "allow"
    assert evaluate([item(5, merchant="Unknown")], rules, 0, NOW).outcome == "deny"


def test_expired_mandate_is_denied():
    rules = Rules(100, 60, 20, expires_at=NOW - timedelta(days=1))
    assert evaluate([item(5)], rules, 0, NOW).outcome == "deny"


def test_paused_mandate_is_denied():
    rules = Rules(100, 60, 20, active=False)
    assert evaluate([item(5)], rules, 0, NOW).outcome == "deny"


def test_empty_cart_is_denied():
    assert evaluate([], RULES, 0, NOW).outcome == "deny"


def test_invalid_quantity_is_denied():
    assert evaluate([item(5, qty=0)], RULES, 0, NOW).outcome == "deny"
