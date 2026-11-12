"""Product search. Uses Channel3 (POST /v1/search) when CHANNEL3_API_KEY is set,
otherwise a built-in demo catalog of café supplies.

Every product the agent sees is cached here by id, and orders are priced from this
cache, never from numbers the LLM writes, so the agent cannot invent a price.
"""
from __future__ import annotations

import re

import httpx

from .config import get_settings

DEMO_CATALOG: list[dict] = [
    {"id": "demo-cups-12oz", "title": "Compostable hot cups, 12 oz, pack of 100", "category": "supplies", "merchant": "GreenCup Supply", "price": 8.99},
    {"id": "demo-cups-8oz", "title": "Paper hot cups, 8 oz, pack of 100", "category": "supplies", "merchant": "CafeSupplyCo", "price": 6.49},
    {"id": "demo-lids-12oz", "title": "Sip lids for 12 oz cups, pack of 100", "category": "supplies", "merchant": "CafeSupplyCo", "price": 4.25},
    {"id": "demo-napkins", "title": "Recycled napkins, pack of 500", "category": "supplies", "merchant": "GreenCup Supply", "price": 5.75},
    {"id": "demo-napkins-premium", "title": "Premium 2-ply dinner napkins, pack of 300", "category": "supplies", "merchant": "CafeSupplyCo", "price": 9.80},
    {"id": "demo-stirrers", "title": "Wooden coffee stirrers, pack of 1000", "category": "supplies", "merchant": "CafeSupplyCo", "price": 3.99},
    {"id": "demo-sugar", "title": "Raw sugar sticks, box of 500", "category": "pantry", "merchant": "BeanBarn Wholesale", "price": 11.50},
    {"id": "demo-oat-milk", "title": "Barista oat milk, case of 6 x 1 L", "category": "pantry", "merchant": "BeanBarn Wholesale", "price": 18.90},
    {"id": "demo-beans-1kg", "title": "Espresso beans, medium roast, 1 kg", "category": "coffee", "merchant": "BeanBarn Wholesale", "price": 21.00},
    {"id": "demo-beans-5kg", "title": "Espresso beans, medium roast, 5 kg", "category": "coffee", "merchant": "BeanBarn Wholesale", "price": 92.00},
    {"id": "demo-sanitizer", "title": "Food-safe surface sanitizer, 1 gal", "category": "cleaning", "merchant": "CleanPro", "price": 14.20},
    {"id": "demo-descaler", "title": "Espresso machine descaler, 1 L", "category": "cleaning", "merchant": "CleanPro", "price": 12.75},
    {"id": "demo-gasket", "title": "Group head gasket and screen kit", "category": "equipment", "merchant": "BaristaParts", "price": 38.00},
    {"id": "demo-grinder-burrs", "title": "Replacement grinder burr set, 64 mm", "category": "equipment", "merchant": "BaristaParts", "price": 64.00},
    {"id": "demo-headphones", "title": "Wireless noise-cancelling headphones", "category": "electronics", "merchant": "GadgetHub", "price": 49.00},
]

_cache: dict[str, dict] = {p["id"]: {**p, "currency": "USD", "url": None, "image": None} for p in DEMO_CATALOG}


def get_product(product_id: str) -> dict | None:
    return _cache.get(product_id)


def _tokens(s: str) -> set[str]:
    words = set(re.findall(r"[a-z0-9]+", s.lower()))
    # crude singularisation so "cup" matches "cups"
    return words | {w[:-1] for w in words if w.endswith("s") and len(w) > 3}


def _demo_search(query: str, max_price: float | None, limit: int) -> list[dict]:
    q = _tokens(query)
    scored = []
    for p in _cache.values():
        if not p["id"].startswith("demo-"):
            continue
        hay = _tokens(f"{p['title']} {p['category']} {p['merchant']}")
        score = len(q & hay)
        if score and (max_price is None or p["price"] <= max_price):
            scored.append((score, -p["price"], p))
    scored.sort(key=lambda t: (t[0], t[1]), reverse=True)
    return [p for _, _, p in scored[:limit]]


def _channel3_search(query: str, max_price: float | None, limit: int) -> list[dict]:
    s = get_settings()
    body: dict = {"query": query, "limit": min(limit, 30)}
    if max_price is not None:
        body["filters"] = {"price": {"max_price": max_price}, "availability": ["InStock"]}
    r = httpx.post(
        f"{s.channel3_base_url}/v1/search",
        json=body,
        headers={"x-api-key": s.channel3_api_key, "Content-Type": "application/json"},
        timeout=20,
    )
    r.raise_for_status()
    out = []
    for prod in r.json().get("products", []):
        offers = prod.get("offers") or []
        if not offers or not offers[0].get("price"):
            continue
        offer = offers[0]
        cat = prod.get("category") or {}
        images = prod.get("images") or []
        item = {
            "id": f"c3-{prod['id']}",
            "title": prod.get("title", "Untitled"),
            "category": (cat.get("name") or cat.get("slug") or "uncategorized").lower() if isinstance(cat, dict) else str(cat).lower(),
            "merchant": offer.get("domain") or ((prod.get("brands") or [{}])[0].get("name") or "unknown"),
            "price": float(offer["price"]["price"]),
            "currency": offer["price"].get("currency", "USD"),
            "url": offer.get("url"),
            "image": next((i.get("cleaned_url") or i.get("url") for i in images if i.get("is_main_image")), None)
            or (images[0].get("url") if images else None),
        }
        _cache[item["id"]] = item
        out.append(item)
    return out


def search(query: str, max_price: float | None = None, limit: int = 6) -> tuple[list[dict], str]:
    """Returns (products, source)."""
    if get_settings().channel3_api_key:
        try:
            return _channel3_search(query, max_price, limit), "channel3"
        except httpx.HTTPError:
            pass  # fall back to the demo catalog so the demo never breaks
    return _demo_search(query, max_price, limit), "demo"
