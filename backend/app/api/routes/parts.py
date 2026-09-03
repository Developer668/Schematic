"""Live parts discovery through the server-side supplier listings provider.

The Bright Data credential is read only by the FastAPI process. Search results
remain discovery records: they can be inspected and opened at the retailer,
but Schematic's existing canonical-publication boundary still decides what may
enter the project bill of materials.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import re
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qs, quote_plus, urlparse

import httpx
from fastapi import APIRouter, Header, Query
from fastapi.responses import JSONResponse

from app.core.config import settings

router = APIRouter()

_MAX_QUERY_LENGTH = 240
_MAX_RESPONSE_BYTES = 12 * 1024 * 1024
_MAX_CACHE_ENTRIES = 64
_PRICE_NUMBER = re.compile(r"-?\d[\d,]*(?:\.\d+)?")
_PART_TOKEN = re.compile(r"\b(?=[A-Za-z0-9._/-]{4,80}\b)(?=[A-Za-z0-9._/-]*\d)[A-Za-z0-9][A-Za-z0-9._/-]*\b")
_CURRENCY_SYMBOLS = {
    "$": "USD",
    "US$": "USD",
    "€": "EUR",
    "£": "GBP",
    "C$": "CAD",
    "CA$": "CAD",
    "A$": "AUD",
    "AU$": "AUD",
    "¥": "JPY",
}


@dataclass(frozen=True)
class _ProviderResponse:
    status_code: int
    body: dict[str, Any]
    headers: dict[str, str]


_cache: OrderedDict[str, tuple[float, _ProviderResponse]] = OrderedDict()
_inflight: dict[str, asyncio.Task[_ProviderResponse]] = {}
_provider_lock = asyncio.Lock()


def _bounded_text(value: Any, limit: int = 240) -> str:
    if not isinstance(value, (str, int, float)):
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()[:limit]


def _first_text(item: dict[str, Any], *keys: str, limit: int = 240) -> str:
    for key in keys:
        value = _bounded_text(item.get(key), limit)
        if value:
            return value
    return ""


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        parsed = float(value)
        return parsed if parsed >= 0 else None
    if isinstance(value, dict):
        for key in ("value", "amount", "price", "extracted_value"):
            parsed = _number(value.get(key))
            if parsed is not None:
                return parsed
        return None
    if not isinstance(value, str):
        return None
    match = _PRICE_NUMBER.search(value)
    if not match:
        return None
    try:
        parsed = float(match.group(0).replace(",", ""))
    except ValueError:
        return None
    return parsed if parsed >= 0 else None


def _integer(value: Any) -> int | None:
    parsed = _number(value)
    return int(parsed) if parsed is not None else None


def _currency(item: dict[str, Any], price_value: Any) -> str | None:
    explicit = _first_text(item, "currency", "currency_code", "currencyCode", limit=3).upper()
    if re.fullmatch(r"[A-Z]{3}", explicit):
        return explicit
    price_text = _bounded_text(price_value, 80)
    for symbol, code in sorted(_CURRENCY_SYMBOLS.items(), key=lambda entry: len(entry[0]), reverse=True):
        if symbol in price_text:
            return code
    configured = settings.BRIGHTDATA_SERP_CURRENCY.strip().upper()
    return configured if re.fullmatch(r"[A-Z]{3}", configured) else None


def _safe_https_url(value: Any) -> str | None:
    candidate = _bounded_text(value, 2_000)
    if not candidate or candidate.startswith("data:"):
        return None
    try:
        parsed = urlparse(candidate)
    except ValueError:
        return None
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        return None
    if parsed.netloc.lower().endswith("google.com") and parsed.path == "/url":
        query = parse_qs(parsed.query)
        redirected = (query.get("q") or query.get("url") or [""])[0]
        if redirected and redirected != candidate:
            return _safe_https_url(redirected)
    return candidate


def _fallback_shopping_url(title: str, retailer: str) -> str:
    lookup = " ".join(part for part in (title, retailer) if part).strip()
    return f"https://www.google.com/search?q={quote_plus(lookup)}&tbm=shop"


def _extract_part_number(item: dict[str, Any], query: str, title: str) -> str:
    explicit = _first_text(
        item,
        "part_number",
        "partNumber",
        "mpn",
        "manufacturer_part_number",
        "manufacturerPartNumber",
        "model",
        "sku",
        limit=120,
    )
    if explicit:
        return explicit
    normalized_query = query.strip()
    if len(normalized_query) <= 120 and any(character.isdigit() for character in normalized_query):
        return normalized_query
    candidates = _PART_TOKEN.findall(title)
    return max(candidates, key=len, default="")[:120]


def _unwrap_json(value: Any) -> Any:
    current = value
    for _ in range(4):
        if isinstance(current, str):
            stripped = current.strip()
            if not stripped or stripped[0] not in "[{\"":
                return current
            try:
                current = json.loads(stripped)
                continue
            except json.JSONDecodeError:
                return current
        if isinstance(current, list) and len(current) == 1:
            current = current[0]
            continue
        if isinstance(current, dict):
            for key in ("body", "content", "response"):
                nested = current.get(key)
                if isinstance(nested, str) and nested.strip().startswith(("{", "[", '"')):
                    try:
                        current = json.loads(nested)
                        break
                    except json.JSONDecodeError:
                        pass
            else:
                return current
            continue
        return current
    return current


def _shopping_items(payload: Any) -> list[dict[str, Any]]:
    unwrapped = _unwrap_json(payload)
    if isinstance(unwrapped, list):
        return [item for item in unwrapped if isinstance(item, dict)]
    if not isinstance(unwrapped, dict):
        return []
    collected: list[dict[str, Any]] = []
    for key in (
        "shopping",
        "shopping_results",
        "shoppingResults",
        "top_pla",
        "pla",
        "products",
        "product_results",
        "productResults",
        "items",
        "results",
    ):
        value = unwrapped.get(key)
        if isinstance(value, list):
            collected.extend(item for item in value if isinstance(item, dict))
    if collected:
        return collected
    for key in ("body", "content", "response", "data", "result"):
        nested = unwrapped.get(key)
        items = _shopping_items(nested)
        if items:
            return items
    return []


def _candidate(item: dict[str, Any], query: str, rank: int) -> dict[str, Any] | None:
    title = _first_text(item, "title", "name", "product_title", "productTitle")
    if not title:
        return None
    retailer = _first_text(item, "shop", "retailer", "seller", "store", "source", limit=160) or "Retailer listing"
    direct_url = None
    for key in ("link", "url", "product_link", "productLink", "product_url", "productUrl", "merchant_link", "href"):
        direct_url = _safe_https_url(item.get(key))
        if direct_url:
            break
    verification_url = direct_url or _fallback_shopping_url(title, retailer)
    raw_price = item.get("extracted_price", item.get("price"))
    price = _number(raw_price)
    currency = _currency(item, raw_price) if price is not None else None
    source_part_id = _first_text(item, "product_id", "productId", "id", "sku", limit=120)
    if not source_part_id:
        source_part_id = hashlib.sha256(f"{title}|{retailer}|{verification_url}|{rank}".encode("utf-8")).hexdigest()[:20]
    part_number = _extract_part_number(item, query, title)
    manufacturer = _first_text(item, "manufacturer", "brand", "maker", limit=160)
    shipping = _first_text(item, "shipping", "delivery", "delivery_info", "deliveryInfo", limit=180)
    availability = _first_text(item, "availability", "stock_status", "stockStatus", limit=120)
    description = _first_text(item, "description", "snippet", "subtitle", limit=420)
    image_url = None
    for key in ("image_url", "imageUrl", "thumbnail", "thumbnail_url", "shop_logo", "image"):
        image_url = _safe_https_url(item.get(key))
        if image_url:
            break
    rating = _number(item.get("rating"))
    if rating is not None and rating > 5:
        rating = None
    review_count = _integer(item.get("reviews_cnt", item.get("reviews", item.get("review_count"))))
    stock = _integer(item.get("stock"))
    candidate_id = hashlib.sha256(f"brightdata|{source_part_id}|{verification_url}".encode("utf-8")).hexdigest()[:24]
    return {
        "id": f"brightdata:{candidate_id}",
        "source": "brightdata-serp",
        "sourcePartId": source_part_id,
        "title": title,
        **({"manufacturer": manufacturer} if manufacturer else {}),
        "partNumber": part_number,
        **({"description": description} if description else {}),
        "stock": stock,
        **({"availability": availability} if availability else {}),
        "price": price,
        "currency": currency,
        "verificationUrl": verification_url,
        "verificationRequired": True,
        "retailer": retailer,
        **({"shipping": shipping} if shipping else {}),
        **({"imageUrl": image_url} if image_url else {}),
        **({"rating": rating} if rating is not None else {}),
        **({"reviewCount": review_count} if review_count is not None else {}),
        "rank": rank,
    }


def _dedupe_candidates(items: list[dict[str, Any]], query: str) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    seen: set[str] = set()
    limit = max(1, min(settings.BRIGHTDATA_SERP_MAX_RESULTS, 24))
    for rank, item in enumerate(items, start=1):
        normalized = _candidate(item, query, rank)
        if not normalized:
            continue
        identity = f"{str(normalized['title']).casefold()}|{str(normalized['retailer']).casefold()}|{normalized['verificationUrl']}"
        if identity in seen:
            continue
        seen.add(identity)
        candidates.append(normalized)
        if len(candidates) >= limit:
            break
    return candidates


def _base_envelope(query: str, quantity: int, *, duration_ms: int, status: str, result_count: int, message: str) -> dict[str, Any]:
    return {
        "query": query,
        "quantity": quantity,
        "source": "brightdata-serp",
        "liveOffers": True,
        "cartEligible": False,
        "sourceOrder": ["brightdata-serp"],
        "attempts": [{
            "source": "brightdata-serp",
            "status": status,
            "durationMs": duration_ms,
            "resultCount": result_count,
            **({"message": message} if status not in {"success", "empty"} else {}),
        }],
        "cacheHit": False,
        "staleCache": False,
        "rateLimited": status == "rate_limited",
        "providerFallback": {
            "attempted": True,
            "providersTried": ["brightdata-serp"],
        },
        "publication": {
            "required": True,
            "returnTool": "shopping.search",
            "reason": "Search results are live web discoveries. Confirm exact component identity and retailer details before adding a canonical record to the build cart.",
        },
        "message": message,
    }


async def _read_bounded_response(response: httpx.Response) -> str:
    chunks: list[bytes] = []
    total = 0
    async for chunk in response.aiter_bytes():
        total += len(chunk)
        if total > _MAX_RESPONSE_BYTES:
            raise ValueError(f"Bright Data response exceeded the {_MAX_RESPONSE_BYTES}-byte safety limit.")
        chunks.append(chunk)
    return b"".join(chunks).decode(response.encoding or "utf-8", errors="replace")


async def _fetch_brightdata(query: str) -> tuple[int, dict[str, str], str]:
    target_url = (
        "https://www.google.com/search"
        f"?q={quote_plus(query)}&tbm=shop&gl={quote_plus(settings.BRIGHTDATA_SERP_COUNTRY.lower())}"
        f"&hl={quote_plus(settings.BRIGHTDATA_SERP_LANGUAGE.lower())}&brd_json=json"
    )
    payloads = [
        {
            "zone": settings.BRIGHTDATA_SERP_ZONE,
            "url": target_url,
            "format": "json",
            "method": "GET",
            "country": settings.BRIGHTDATA_SERP_COUNTRY.lower(),
        },
        {
            "zone": settings.BRIGHTDATA_SERP_ZONE,
            "url": target_url,
            "format": "raw",
            "method": "GET",
            "country": settings.BRIGHTDATA_SERP_COUNTRY.lower(),
        },
    ]
    timeout = httpx.Timeout(max(5.0, min(settings.BRIGHTDATA_SERP_TIMEOUT_SECONDS, 60.0)))
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": f"Bearer {settings.BRIGHTDATA_API_KEY}",
    }
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        for index, payload in enumerate(payloads):
            async with client.stream("POST", settings.BRIGHTDATA_SERP_ENDPOINT, headers=headers, json=payload) as response:
                body = await _read_bounded_response(response)
                if response.status_code not in {400, 422} or index == len(payloads) - 1:
                    return response.status_code, dict(response.headers), body
    raise RuntimeError("Bright Data request completed without a response.")


async def _provider_search(query: str, quantity: int) -> _ProviderResponse:
    started = time.perf_counter()
    try:
        status_code, upstream_headers, raw_body = await _fetch_brightdata(query)
    except httpx.TimeoutException:
        duration_ms = round((time.perf_counter() - started) * 1_000)
        message = "Bright Data did not finish the shopping search in time. Retry the request."
        return _ProviderResponse(504, {"code": "BRIGHTDATA_TIMEOUT", **_base_envelope(query, quantity, duration_ms=duration_ms, status="timeout", result_count=0, message=message), "candidates": []}, {})
    except (httpx.HTTPError, ValueError) as error:
        duration_ms = round((time.perf_counter() - started) * 1_000)
        message = _bounded_text(str(error), 200) or "Bright Data could not complete the shopping search."
        return _ProviderResponse(503, {"code": "BRIGHTDATA_UNAVAILABLE", **_base_envelope(query, quantity, duration_ms=duration_ms, status="error", result_count=0, message=message), "candidates": []}, {})

    duration_ms = round((time.perf_counter() - started) * 1_000)
    retry_after = _bounded_text(upstream_headers.get("retry-after"), 20)
    if status_code == 429:
        retry_seconds = int(retry_after) if retry_after.isdigit() else 30
        message = "Bright Data is rate limiting shopping searches. Wait briefly, then retry."
        return _ProviderResponse(429, {"code": "BRIGHTDATA_RATE_LIMITED", **_base_envelope(query, quantity, duration_ms=duration_ms, status="rate_limited", result_count=0, message=message), "retryAfterSeconds": retry_seconds, "candidates": []}, {"Retry-After": str(retry_seconds)})
    if status_code in {401, 403}:
        message = "Bright Data rejected the server credential or the SERP zone configuration."
        return _ProviderResponse(503, {"code": "BRIGHTDATA_AUTH_ERROR", **_base_envelope(query, quantity, duration_ms=duration_ms, status="error", result_count=0, message=message), "candidates": []}, {})
    if status_code < 200 or status_code >= 300:
        message = f"Bright Data returned HTTP {status_code} for the shopping search."
        return _ProviderResponse(502 if status_code < 500 else 503, {"code": "BRIGHTDATA_UPSTREAM_ERROR", **_base_envelope(query, quantity, duration_ms=duration_ms, status="error", result_count=0, message=message), "candidates": []}, {})

    try:
        payload = json.loads(raw_body)
    except json.JSONDecodeError:
        message = "Bright Data returned a response that was not Full JSON. Check the SERP zone response format."
        return _ProviderResponse(502, {"code": "BRIGHTDATA_INVALID_JSON", **_base_envelope(query, quantity, duration_ms=duration_ms, status="error", result_count=0, message=message), "candidates": []}, {})

    candidates = _dedupe_candidates(_shopping_items(payload), query)
    if not candidates:
        message = "No supplier listings matched this search. Try an exact manufacturer part number or board name."
        return _ProviderResponse(200, {"code": "BRIGHTDATA_NO_RESULTS", **_base_envelope(query, quantity, duration_ms=duration_ms, status="empty", result_count=0, message=message), "candidates": []}, {"Cache-Control": "private, max-age=30"})

    message = f"Found {len(candidates)} current supplier listing{'s' if len(candidates) != 1 else ''}. Confirm the exact model, seller, stock, shipping, and checkout price before purchasing."
    return _ProviderResponse(200, {"code": "LIVE_SHOPPING_RESULTS", **_base_envelope(query, quantity, duration_ms=duration_ms, status="success", result_count=len(candidates), message=message), "candidates": candidates}, {"Cache-Control": "private, max-age=30"})


def _cache_key(query: str, quantity: int) -> str:
    return f"{query.casefold()}\0{quantity}\0{settings.BRIGHTDATA_SERP_ZONE}\0{settings.BRIGHTDATA_SERP_COUNTRY.lower()}"


def _cached(key: str) -> _ProviderResponse | None:
    cached = _cache.get(key)
    if not cached:
        return None
    expires_at, response = cached
    if expires_at <= time.monotonic():
        _cache.pop(key, None)
        return None
    _cache.move_to_end(key)
    return _ProviderResponse(response.status_code, {**response.body, "cacheHit": True}, response.headers)


def _remember(key: str, response: _ProviderResponse) -> None:
    if response.status_code != 200:
        return
    ttl = max(15, min(settings.BRIGHTDATA_SERP_CACHE_TTL_SECONDS, 900))
    _cache[key] = (time.monotonic() + ttl, response)
    _cache.move_to_end(key)
    while len(_cache) > _MAX_CACHE_ENTRIES:
        _cache.popitem(last=False)


@router.get("/search")
async def search(
    query: str = Query(default="", max_length=_MAX_QUERY_LENGTH),
    quantity: int = Query(default=1, ge=1, le=999),
    request_id: str | None = Header(default=None, alias="X-Schematic-Request-Id"),
):
    normalized_request_id = _bounded_text(request_id, 200)
    if not normalized_request_id.startswith("parts-"):
        return JSONResponse(status_code=400, content={"code": "INVALID_REQUEST_ID", "message": "A valid Schematic parts request ID is required."})
    normalized_query = re.sub(r"\s+", " ", query).strip()[:_MAX_QUERY_LENGTH]
    if not normalized_query:
        return JSONResponse(status_code=400, content={"code": "INVALID_QUERY", "message": "Enter a part number, board, component, or manufacturer before searching.", "query": "", "quantity": quantity})
    if not settings.BRIGHTDATA_API_KEY.strip():
        return JSONResponse(status_code=503, content={
            "code": "PARTS_PROVIDER_NOT_CONFIGURED",
            "message": "The server-side Bright Data SERP credential is not configured.",
            "query": normalized_query,
            "quantity": quantity,
            "liveOffers": False,
            "candidates": [],
        })

    key = _cache_key(normalized_query, quantity)
    cached = _cached(key)
    if cached:
        return JSONResponse(status_code=cached.status_code, content=cached.body, headers=cached.headers)

    async with _provider_lock:
        task = _inflight.get(key)
        if task is None or task.done():
            task = asyncio.create_task(_provider_search(normalized_query, quantity))
            _inflight[key] = task

    try:
        response = await asyncio.shield(task)
    finally:
        async with _provider_lock:
            if _inflight.get(key) is task and task.done():
                _inflight.pop(key, None)

    _remember(key, response)
    return JSONResponse(status_code=response.status_code, content=response.body, headers=response.headers)
