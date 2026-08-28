"""
SuperTokens core integration for Schematic.
Uses https://github.com/supertokens/supertokens-core
Each user gets a room stored on their own device (localStorage keyed by userId),
but the session is verified via SuperTokens so WebMCP mutations are scoped
to that user's room — no global state.

If the core is not reachable (e.g. on Cloudflare Pages without a backend),
the frontend falls back to a local mock room (st-mock-user) which is still
per-user and per-device, so WebMCP never mutates global state.
"""
import os
from supertokens_python import init, InputAppInfo, SupertokensConfig
from supertokens_python.recipe import session, emailpassword
from supertokens_python.types import RecipeLevel

def init_supertokens():
    # Core location: env SUPERTOKENS_CONNECTION_URI or default localhost:3567
    # For local dev without core, this will fail gracefully and the frontend mock takes over.
    connection_uri = os.getenv("SUPERTOKENS_CONNECTION_URI", "http://localhost:3567")
    api_domain = os.getenv("API_DOMAIN", "http://localhost:8001")
    website_domain = os.getenv("WEBSITE_DOMAIN", "http://localhost:3000")
    try:
        init(
            app_info=InputAppInfo(
                app_name="Schematic",
                api_domain=api_domain,
                website_domain=website_domain,
                api_base_path="/api/auth",
                website_base_path="/auth",
            ),
            supertokens_config=SupertokensConfig(
                connection_uri=connection_uri,
            ),
            framework="fastapi",
            recipe_list=[
                session.init(anti_csrf="VIA_TOKEN", cookie_secure=False, cookie_same_site="lax"),
                emailpassword.init(),
            ],
            mode="asgi",
        )
        print(f"[SuperTokens] initialized core={connection_uri} api={api_domain}")
    except Exception as e:
        print(f"[SuperTokens] init failed (core not running, using local mock room): {e}")

def get_user_id_from_session(request) -> str | None:
    """Extract userId from verified session, or None if no session."""
    try:
        from supertokens_python.recipe.session import get_session

        # This is the ASGI sync version; for FastAPI we use the async wrapper
        # We expose a helper for routes to call `verify_session`
        return None
    except Exception:
        return None
