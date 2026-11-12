"""Phase 1 check: prove the PayPal sandbox money path end to end.

create order (AUTHORIZE) -> you approve in the browser as the sandbox buyer
-> authorize -> capture -> refund

Run from backend/:  python -m scripts.paypal_smoke
Needs PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in backend/.env
"""
import uuid

from app.config import get_settings
from app.paypal import PayPalClient


def main() -> None:
    s = get_settings()
    if s.paypal_mock:
        raise SystemExit("Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in backend/.env first.")
    pp = PayPalClient(s)
    ref = f"smoke-{uuid.uuid4().hex[:8]}"
    items = [{"title": "Smoke test: paper cups", "unit_price": 4.50, "quantity": 2}]

    order = pp.create_authorized_order(
        items=items, currency=s.currency, reference_id=ref, description="Mandate smoke test",
        vault_id=None, request_id=f"{ref}-create",
        return_url="https://example.com/return", cancel_url="https://example.com/cancel",
    )
    print(f"1. Order {order.order_id} created, status {order.status}")
    print(f"2. Open this link, log in as your SANDBOX BUYER and approve:\n   {order.approve_url}")
    input("   Press Enter after approving (ignore the example.com page it lands on)... ")

    auth_id = pp.authorize_order(order.order_id, f"{ref}-authorize")
    print(f"3. Authorized: {auth_id}")
    cap_id = pp.capture_authorization(auth_id, f"{ref}-capture")
    print(f"4. Captured:   {cap_id}")
    ref_id = pp.refund_capture(cap_id, note="Smoke test refund", request_id=f"{ref}-refund", currency=s.currency)
    print(f"5. Refunded:   {ref_id}\nMoney path works.")


if __name__ == "__main__":
    main()
