"""Thin PayPal REST client (sandbox): Orders v2, Payments v2, Vault v3, webhook verification.

With no PAYPAL_CLIENT_ID set, every call is simulated (mock mode) so the app and tests
run without credentials. The mock follows the same shapes and states as the real API.
"""
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass

import httpx

from .config import Settings, get_settings


class PayPalError(RuntimeError):
    def __init__(self, message: str, status: int | None = None, details: dict | None = None):
        super().__init__(message)
        self.status = status
        self.details = details or {}


@dataclass
class AuthorizedOrder:
    order_id: str
    status: str  # COMPLETED (authorized) | PAYER_ACTION_REQUIRED
    authorization_id: str | None = None
    approve_url: str | None = None


def _money(value: float, currency: str) -> dict:
    return {"currency_code": currency, "value": f"{value:.2f}"}


def _mock_id(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex[:15].upper()}"


class PayPalClient:
    def __init__(self, settings: Settings | None = None, http: httpx.Client | None = None):
        self.s = settings or get_settings()
        self.mock = self.s.paypal_mock
        self._http = http or httpx.Client(base_url=self.s.paypal_base_url, timeout=30)
        self._token: str | None = None
        self._token_exp = 0.0

    # ---------- auth ----------
    def _access_token(self) -> str:
        if self._token and time.time() < self._token_exp - 60:
            return self._token
        r = self._http.post(
            "/v1/oauth2/token",
            auth=(self.s.paypal_client_id, self.s.paypal_client_secret),
            data={"grant_type": "client_credentials"},
        )
        if r.status_code != 200:
            raise PayPalError("Could not get a PayPal access token", r.status_code, _safe_json(r))
        body = r.json()
        self._token = body["access_token"]
        self._token_exp = time.time() + int(body.get("expires_in", 3000))
        return self._token

    def _request(self, method: str, path: str, *, json: dict | None = None, request_id: str | None = None) -> dict:
        headers = {"Authorization": f"Bearer {self._access_token()}", "Content-Type": "application/json"}
        if request_id:
            headers["PayPal-Request-Id"] = request_id  # idempotency key
        headers["Prefer"] = "return=representation"
        r = self._http.request(method, path, json=json, headers=headers)
        if r.status_code >= 400:
            body = _safe_json(r)
            msg = body.get("message") or body.get("error_description") or r.text[:200]
            raise PayPalError(f"PayPal {method} {path} failed: {msg}", r.status_code, body)
        return _safe_json(r)

    # ---------- Vault v3: save the owner's PayPal wallet once ----------
    def create_setup_token(self, return_url: str, cancel_url: str) -> dict:
        if self.mock:
            tid = _mock_id("SETUP-")
            return {"id": tid, "approve_url": f"{return_url}?approval_token_id={tid}&mock=1"}
        body = {
            "payment_source": {
                "paypal": {
                    "usage_type": "MERCHANT",
                    "experience_context": {
                        "return_url": return_url,
                        "cancel_url": cancel_url,
                        "shipping_preference": "NO_SHIPPING",
                    },
                }
            }
        }
        res = self._request("POST", "/v3/vault/setup-tokens", json=body, request_id=str(uuid.uuid4()))
        approve = next((l["href"] for l in res.get("links", []) if l.get("rel") == "approve"), None)
        return {"id": res["id"], "approve_url": approve}

    def create_payment_token(self, setup_token_id: str) -> dict:
        if self.mock:
            return {"id": _mock_id("VAULT-"), "payer_email": "sb-buyer@personal.example.com"}
        body = {"payment_source": {"token": {"id": setup_token_id, "type": "SETUP_TOKEN"}}}
        res = self._request("POST", "/v3/vault/payment-tokens", json=body, request_id=str(uuid.uuid4()))
        email = res.get("payment_source", {}).get("paypal", {}).get("email_address")
        return {"id": res["id"], "payer_email": email}

    # ---------- Orders v2: authorize now, capture later ----------
    def create_authorized_order(
        self,
        *,
        items: list[dict],
        currency: str,
        reference_id: str,
        description: str,
        vault_id: str | None,
        request_id: str,
        return_url: str | None = None,
        cancel_url: str | None = None,
    ) -> AuthorizedOrder:
        """Create an AUTHORIZE-intent order. With a vault_id PayPal authorizes immediately
        (no buyer popup); without one the buyer must approve at approve_url first."""
        total = round(sum(round(i["unit_price"], 2) * i["quantity"] for i in items), 2)
        if self.mock:
            if vault_id:
                return AuthorizedOrder(_mock_id("ORDER-"), "COMPLETED", _mock_id("AUTH-"))
            oid = _mock_id("ORDER-")
            return AuthorizedOrder(oid, "PAYER_ACTION_REQUIRED", approve_url=f"{return_url}?token={oid}&mock=1")

        unit = {
            "reference_id": reference_id,
            "description": description[:127],
            "amount": {**_money(total, currency), "breakdown": {"item_total": _money(total, currency)}},
            "items": [
                {
                    "name": i["title"][:127],
                    "quantity": str(i["quantity"]),
                    "unit_amount": _money(i["unit_price"], currency),
                    "category": "PHYSICAL_GOODS",
                }
                for i in items
            ],
        }
        body: dict = {"intent": "AUTHORIZE", "purchase_units": [unit]}
        if vault_id:
            body["payment_source"] = {"paypal": {"vault_id": vault_id}}
        else:
            body["payment_source"] = {
                "paypal": {
                    "experience_context": {
                        "return_url": return_url,
                        "cancel_url": cancel_url,
                        "user_action": "CONTINUE",
                        "shipping_preference": "NO_SHIPPING",
                    }
                }
            }
        res = self._request("POST", "/v2/checkout/orders", json=body, request_id=request_id)
        auth_id = _first_authorization(res)
        approve = next((l["href"] for l in res.get("links", []) if l.get("rel") == "payer-action"), None)
        return AuthorizedOrder(res["id"], res.get("status", ""), auth_id, approve)

    def authorize_order(self, order_id: str, request_id: str) -> str:
        """After the buyer approves in the popup (no-vault path)."""
        if self.mock:
            return _mock_id("AUTH-")
        res = self._request("POST", f"/v2/checkout/orders/{order_id}/authorize", json={}, request_id=request_id)
        auth_id = _first_authorization(res)
        if not auth_id:
            raise PayPalError("PayPal returned no authorization", details=res)
        return auth_id

    # ---------- Payments v2 ----------
    def capture_authorization(self, authorization_id: str, request_id: str) -> str:
        if self.mock:
            return _mock_id("CAP-")
        res = self._request(
            "POST", f"/v2/payments/authorizations/{authorization_id}/capture",
            json={"final_capture": True}, request_id=request_id,
        )
        return res["id"]

    def void_authorization(self, authorization_id: str) -> None:
        if self.mock:
            return
        self._request("POST", f"/v2/payments/authorizations/{authorization_id}/void", json={})

    def refund_capture(self, capture_id: str, *, note: str, request_id: str,
                       amount: float | None = None, currency: str = "USD") -> str:
        if self.mock:
            return _mock_id("REF-")
        body: dict = {"note_to_payer": note[:255]}
        if amount is not None:
            body["amount"] = _money(amount, currency)
        res = self._request("POST", f"/v2/payments/captures/{capture_id}/refund", json=body, request_id=request_id)
        return res["id"]

    # ---------- Webhooks ----------
    def verify_webhook(self, headers: dict, event: dict) -> bool:
        if self.mock or not self.s.paypal_webhook_id:
            return True  # nothing to verify against in mock mode
        h = {k.lower(): v for k, v in headers.items()}
        body = {
            "auth_algo": h.get("paypal-auth-algo"),
            "cert_url": h.get("paypal-cert-url"),
            "transmission_id": h.get("paypal-transmission-id"),
            "transmission_sig": h.get("paypal-transmission-sig"),
            "transmission_time": h.get("paypal-transmission-time"),
            "webhook_id": self.s.paypal_webhook_id,
            "webhook_event": event,
        }
        res = self._request("POST", "/v1/notifications/verify-webhook-signature", json=body)
        return res.get("verification_status") == "SUCCESS"


def _first_authorization(order: dict) -> str | None:
    for pu in order.get("purchase_units", []):
        for a in pu.get("payments", {}).get("authorizations", []):
            return a.get("id")
    return None


def _safe_json(r: httpx.Response) -> dict:
    try:
        return r.json()
    except ValueError:
        return {}


_client: PayPalClient | None = None


def get_paypal() -> PayPalClient:
    global _client
    if _client is None:
        _client = PayPalClient()
    return _client
