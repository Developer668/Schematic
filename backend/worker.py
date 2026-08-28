"""Cloudflare Python Worker entrypoint for the existing FastAPI application.

This adapter is intentionally thin: local development continues to use
``uvicorn app.main:app`` while Cloudflare's Python Workers ASGI bridge hosts
the same application at the edge.  The compile route remains honest about
the platform boundary: Workers cannot launch ``arduino-cli`` or arbitrary
subprocesses, so it reports preflight/unavailable rather than pretending to
produce a firmware artifact.
"""

from workers import asgi

from app.main import app


# Python Workers expects the ASGI entrypoint to be exported from the module
# named by Wrangler's ``main`` setting.
Default = asgi.entrypoint(app)
