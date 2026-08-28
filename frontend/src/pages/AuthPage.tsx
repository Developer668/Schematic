import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { EmailPasswordPreBuiltUI } from "supertokens-auth-react/recipe/emailpassword/prebuiltui";
import { canHandleRoute } from "supertokens-auth-react/ui";
import { mockSignIn } from "../auth/supertokens";
import LogoMark from "../components/LogoMark";

export default function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"choose" | "supertokens" | "mock">("choose");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleMock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (!email || !password) throw new Error("Email and password required");
      await mockSignIn(email.trim().toLowerCase(), password);
      navigate("/studio", { replace: true });
    } catch (err: any) {
      setError(err.message || "Mock sign-in failed");
    } finally {
      setLoading(false);
    }
  };

  // If SuperTokens core is reachable, show its UI; otherwise fall back to mock
  if (mode === "supertokens") {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <header className="h-14 border-b border-border flex items-center px-4 gap-3">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="brand-mark"><LogoMark /></span> Schematic
          </Link>
          <button onClick={() => setMode("choose")} className="ml-auto text-sm text-muted-foreground hover:text-foreground">← Back</button>
        </header>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-[420px]">
            <div className="mb-6">
              <h1 className="text-xl font-semibold">Sign in with SuperTokens</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Uses{" "}
                <a href="https://github.com/supertokens/supertokens-core" target="_blank" rel="noreferrer" className="underline">
                  supertokens/supertokens-core
                </a>{" "}
                at <code className="px-1 py-0.5 rounded bg-muted text-xs">/api/auth</code>. Run the core via{" "}
                <code className="px-1 py-0.5 rounded bg-muted text-xs">docker run -p 3567:3567 supertokens/supertokens-postgresql</code> or
                see <code>backend/README.md</code>.
              </p>
            </div>
            {/* SuperTokens EmailPassword UI */}
            <div className="rounded-lg border border-border p-4 bg-card">
              {/* The prebuilt UI will mount here via SuperTokens.canHandleRoute */}
              <p className="text-sm text-muted-foreground">
                If the core is not running, you will be redirected back to the mock room.
              </p>
              <div className="mt-4">
                {canHandleRoute([EmailPasswordPreBuiltUI]) ? (
                  <div>Loading SuperTokens UI…</div>
                ) : (
                  <p className="text-sm">Core not reachable — use the local device room instead.</p>
                )}
              </div>
              <button onClick={() => setMode("mock")} className="mt-4 w-full rounded-md border border-border py-2 text-sm hover:bg-muted">
                Use local device room instead
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (mode === "mock") {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <header className="h-14 border-b border-border flex items-center px-4 gap-3">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="brand-mark"><LogoMark /></span> Schematic
          </Link>
          <button onClick={() => setMode("choose")} className="ml-auto text-sm text-muted-foreground hover:text-foreground">← Back</button>
        </header>
        <div className="flex-1 flex items-center justify-center p-6">
          <form onSubmit={handleMock} className="w-full max-w-[420px] rounded-xl border border-border bg-card p-6 shadow-sm">
            <h1 className="text-xl font-semibold">Local device room</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Each user gets a room stored <b>on their own device</b> (<code>localStorage</code> keyed by your user). WebMCP will only mutate <i>your</i> room — no global state.
            </p>
            <div className="mt-5 space-y-3">
              <label className="block">
                <span className="text-xs font-medium">Email (used only to derive your room ID)</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@lab.edu"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  required
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium">Password (local check only)</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  required
                />
              </label>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-md bg-foreground text-background py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50"
              >
                {loading ? "Creating room…" : "Create / Enter my room →"}
              </button>
              <p className="text-xs text-muted-foreground text-center">
                No data leaves your device. Clear site data to reset. For production, run{" "}
                <code>supertokens-core</code> and use the SuperTokens flow.
              </p>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="h-14 border-b border-border flex items-center px-4 gap-2">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <span className="brand-mark"><LogoMark /></span> Schematic
        </Link>
        <span className="ml-2 hidden sm:inline text-xs text-muted-foreground">Auth • per-user room</span>
        <Link to="/studio" className="ml-auto text-sm text-muted-foreground hover:text-foreground">Skip → Studio</Link>
      </header>
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-[640px]">
          <div className="text-center">
            <h1 className="text-3xl font-bold tracking-tight">Choose how you sign in</h1>
            <p className="text-sm text-muted-foreground mt-2">
              SuperTokens core (<a href="https://github.com/supertokens/supertokens-core" target="_blank" rel="noreferrer" className="underline">supertokens/supertokens-core</a>) when
              available, otherwise a secure local device room. Either way, WebMCP is scoped to <b>your</b> room.
            </p>
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <button
              onClick={() => setMode("supertokens")}
              className="text-left rounded-xl border border-border bg-card p-5 hover:bg-muted/50 transition"
            >
              <div className="h-9 w-9 rounded-lg bg-foreground text-background grid place-items-center text-sm font-bold">ST</div>
              <h3 className="mt-3 font-semibold">SuperTokens core</h3>
              <p className="text-sm text-muted-foreground mt-1">Email/Password via self-hosted core at <code>/api/auth</code>. Sessions via JWT, required for team rooms.</p>
              <span className="mt-4 inline-flex text-sm font-medium">Use SuperTokens →</span>
            </button>
            <button
              onClick={() => setMode("mock")}
              className="text-left rounded-xl border-2 border-foreground bg-card p-5 shadow-sm hover:bg-muted/50 transition"
            >
              <div className="h-9 w-9 rounded-lg bg-emerald-600 text-white grid place-items-center text-sm font-bold">◈</div>
              <h3 className="mt-3 font-semibold">Local device room ✓ Recommended</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Instant, offline, stored on <b>your device only</b> (<code>localStorage</code> + <code>BroadcastChannel</code>). No global state — WebMCP can place hardware for you, but never another user.
              </p>
              <span className="mt-4 inline-flex text-sm font-medium">Enter my room →</span>
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-6 text-center">
            Want a shared team room? Run <code>supertokens-core</code> and set <code>VITE_API_DOMAIN</code>. See <code>backend/README.md</code> for `docker run -p 3567:3567 supertokens/supertokens-postgresql`.
          </p>
        </div>
      </div>
    </div>
  );
}
