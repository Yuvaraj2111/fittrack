"""Small, defensive Open Food Facts read client.

Nutrition fields are community-provided data and are returned as estimates per
100 g. The caller always retains control over the serving size before logging.
"""
from __future__ import annotations

from time import monotonic
from typing import Any
import httpx

OFF_BASE_URL = "https://world.openfoodfacts.org"
FIELDS = "code,product_name,brands,serving_size,nutriments"
_CACHE_SECONDS = 15 * 60
_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}


def _number(value: Any) -> float:
    try:
        return max(float(value or 0), 0)
    except (TypeError, ValueError):
        return 0.0


def _serving_grams(value: Any) -> float:
    if not isinstance(value, str):
        return 100.0
    digits = "".join(char for char in value if char.isdigit() or char == ".")
    try:
        return float(digits) if digits else 100.0
    except ValueError:
        return 100.0


def normalize_product(product: dict[str, Any]) -> dict[str, Any] | None:
    name = str(product.get("product_name") or "").strip()
    if not name:
        return None
    nutrients = product.get("nutriments") or {}
    calories = nutrients.get("energy-kcal_100g", nutrients.get("energy-kcal", 0))
    return {
        "barcode": str(product.get("code") or "") or None,
        "name": name,
        "brand": str(product.get("brands") or "").strip() or None,
        "serving_g": _serving_grams(product.get("serving_size")),
        "calories": _number(calories),
        "protein_g": _number(nutrients.get("proteins_100g")),
        "carbs_g": _number(nutrients.get("carbohydrates_100g")),
        "fat_g": _number(nutrients.get("fat_100g")),
        "fiber_g": _number(nutrients.get("fiber_100g")),
        "source": "open_food_facts",
    }


async def search_foods(query: str) -> list[dict[str, Any]]:
    cache_key = f"search:{query.casefold().strip()}"
    cached = _cache.get(cache_key)
    if cached and monotonic() - cached[0] < _CACHE_SECONDS:
        return cached[1]
    params = {"search_terms": query, "search_simple": "1", "action": "process", "json": "1", "page_size": "10", "fields": FIELDS}
    headers = {"User-Agent": "FitTrack/0.1 (personal health tracker)"}
    async with httpx.AsyncClient(timeout=6.0, headers=headers) as client:
        response = await client.get(f"{OFF_BASE_URL}/cgi/search.pl", params=params)
        response.raise_for_status()
    results = [item for raw in response.json().get("products", []) if (item := normalize_product(raw))]
    _cache[cache_key] = (monotonic(), results)
    return results


async def food_by_barcode(barcode: str) -> dict[str, Any] | None:
    cache_key = f"barcode:{barcode}"
    cached = _cache.get(cache_key)
    if cached and monotonic() - cached[0] < _CACHE_SECONDS:
        return cached[1][0] if cached[1] else None
    headers = {"User-Agent": "FitTrack/0.1 (personal health tracker)"}
    async with httpx.AsyncClient(timeout=6.0, headers=headers) as client:
        response = await client.get(f"{OFF_BASE_URL}/api/v3/product/{barcode}", params={"fields": FIELDS})
        response.raise_for_status()
    payload = response.json()
    product = normalize_product(payload.get("product") or {}) if payload.get("status") == 1 else None
    _cache[cache_key] = (monotonic(), [product] if product else [])
    return product
