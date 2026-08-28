"""Parts-provider boundary for agent-assisted procurement.

Prices are intentionally not fabricated by the backend. A connected WebMCP
agent/provider may supply normalized listings to the frontend; until a
provider is configured this endpoint returns an explicit 503 so the frontend
can use its catalog-link fallback and label every price as unavailable.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

router = APIRouter()


@router.get("/search")
def search(query: str = Query(default=""), quantity: int = Query(default=1, ge=1, le=999)):
    raise HTTPException(
        status_code=503,
        detail={
            "code": "PARTS_PROVIDER_NOT_CONFIGURED",
            "message": "No live parts provider is configured for this backend.",
            "query": query,
            "quantity": quantity,
            "liveOffers": False,
            "hint": "Supply listings through the shopping WebMCP tool or configure a provider before treating prices as live.",
        },
    )
