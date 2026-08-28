import SuperTokens from "supertokens-auth-react";
import EmailPassword from "supertokens-auth-react/recipe/emailpassword";
import Session from "supertokens-auth-react/recipe/session";
import { useEffect, useState } from "react";

// SuperTokens core is expected at http://localhost:3567 for local dev.
// In production (Cloudflare Pages), the API is proxied via /api/auth
// which is handled by the FastAPI backend that embeds supertokens-python.
// If the core is not reachable, we fall back to a local mock that still
// provides per-user room isolation on device (see useAuth mock).

const apiDomain = import.meta.env.VITE_API_DOMAIN || window.location.origin;
const websiteDomain = window.location.origin;

export function initSuperTokens() {
  // Avoid double init in HMR
  if ((window as any).__supertokensInit) return;
  (window as any).__supertokensInit = true;

  SuperTokens.init({
    appInfo: {
      appName: "Schematic",
      apiDomain,
      websiteDomain,
      apiBasePath: "/api/auth",
      websiteBasePath: "/auth",
    },
    recipeList: [
      EmailPassword.init({
        // Use the default SuperTokens UI; we will mount it at /auth
        signInAndUpFeature: {
          signUpForm: {
            formFields: [
              { id: "email", label: "Email", placeholder: "you@lab.edu" },
              { id: "password", label: "Password", placeholder: "••••••••" },
            ],
          },
        },
      }),
      Session.init({
        // Use localStorage for per-device room persistence; session still validates via core
        tokenTransferMethod: "header",
        autoAddCredentials: true,
      }),
    ],
    // For static hosting, we enable the in-memory mock fallback when core is unreachable
    // The actual supertokens-core is at https://github.com/supertokens/supertokens-core
    // and can be run via `docker run -p 3567:3567 supertokens/supertokens-postgresql`
    // or `java -jar supertokens-core-*.jar`. See backend/README for setup.
  });
}

// Lightweight hook that works both with real SuperTokens and with the local mock.
// The mock stores a pseudo-user in localStorage under `st-mock-user`, giving each
// browser profile a stable userId and thus a per-user room stored on device.
export function useAuth() {
  const [session, setSession] = useState<{ userId: string; email?: string; isMock?: boolean } | null>(() => {
    // Try to read mock user first (for offline / when core not running)
    try {
      const raw = localStorage.getItem("st-mock-user");
      if (raw) return JSON.parse(raw);
    } catch {}
    return null;
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        // Try real SuperTokens session
        const hasSession = await Session.doesSessionExist();
        if (hasSession) {
          const payload = await Session.getAccessTokenPayloadSecurely();
          const userId = (payload as any)?.sub || (payload as any)?.userId || "st-user";
          const email = (payload as any)?.email;
          if (!cancelled) setSession({ userId, email });
          return;
        }
      } catch {}
      // Fallback to mock or unauthenticated
      try {
        const raw = localStorage.getItem("st-mock-user");
        if (raw && !cancelled) setSession(JSON.parse(raw));
      } catch {}
      if (!cancelled) setLoading(false);
    }
    check();
    // Also poll for mock changes (e.g., after mock login)
    const onStorage = () => {
      try {
        const raw = localStorage.getItem("st-mock-user");
        if (!cancelled) setSession(raw ? JSON.parse(raw) : null);
      } catch {}
    };
    window.addEventListener("storage", onStorage);
    // Also listen for custom event from mock login
    const onMock = () => onStorage();
    window.addEventListener("st-mock-login", onMock as any);
    setLoading(false);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("st-mock-login", onMock as any);
    };
  }, []);

  return { session, loading, isAuthenticated: !!session };
}

// Mock login for when supertokens-core is not running (still gives per-user room on device)
// This is used on the deployed Pages site until a dedicated core is provisioned.
// It creates a deterministic userId from email and stores it in localStorage.
export async function mockSignIn(email: string, password: string) {
  // Simple deterministic userId (hash of email)
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = ((hash << 5) - hash + email.charCodeAt(i)) | 0;
  const userId = `mock-${Math.abs(hash).toString(36)}-${btoa(email).slice(0, 6).replace(/[^a-zA-Z0-9]/g, "")}`;
  const user = { userId, email, isMock: true };
  localStorage.setItem("st-mock-user", JSON.stringify(user));
  window.dispatchEvent(new Event("st-mock-login"));
  return user;
}

export async function mockSignOut() {
  localStorage.removeItem("st-mock-user");
  try {
    await Session.signOut();
  } catch {}
  window.dispatchEvent(new Event("st-mock-login"));
}

export function getCurrentUserId(): string | null {
  try {
    const raw = localStorage.getItem("st-mock-user");
    if (raw) return JSON.parse(raw).userId;
  } catch {}
  return null;
}
