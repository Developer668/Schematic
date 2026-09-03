import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import LogoMark from "../components/LogoMark";
import { authLoginUrl, getAuthMode } from "../auth/session";
import { chatGPTOAuthConfigured, startChatGPTSignIn } from "../auth/chatgptOAuth";
import { firebaseConfigured, signInWithFirebase } from "../auth/firebase";

function platformLabel() {
  return getAuthMode() === "chatgpt-sites" ? "ChatGPT" : "workspace";
}

export default function AuthPage() {
  const navigate = useNavigate();
  const [pending, setPending] = useState<"firebase" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const showFirebase = firebaseConfigured();
  const showChatGPT = chatGPTOAuthConfigured();

  const continueWithFirebase = async () => {
    setPending("firebase");
    setError(null);
    try {
      await signInWithFirebase();
      navigate("/studio", { replace: true });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Firebase sign-in failed.");
      setPending(null);
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="flex h-14 items-center gap-2 border-b border-border px-4">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <span className="brand-mark"><LogoMark /></span> Schematic
        </Link>
        <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">Secure workspace</span>
        <Link to="/" className="ml-auto text-sm text-muted-foreground hover:text-foreground">Back home</Link>
      </header>

      <section className="grid min-h-[calc(100vh-3.5rem)] place-items-center p-6">
        <div className="w-full max-w-[440px] rounded-2xl border border-border bg-card p-7 shadow-sm">
          <div className="mb-6 flex h-10 w-10 items-center justify-center rounded-xl bg-foreground text-background">
            <LogoMark />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Schematic studio</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Continue to your workspace</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Sign-in is handled by your {platformLabel()} identity. Your projects, WebMCP actions, and preview sessions are scoped to that verified account.
          </p>
          <div className="mt-7 flex flex-col gap-2">
            {showFirebase ? (
              <button
                type="button"
                onClick={() => void continueWithFirebase()}
                disabled={pending !== null}
                className="flex w-full items-center justify-center rounded-lg bg-foreground px-4 py-3 text-sm font-semibold text-background transition hover:opacity-90 disabled:opacity-60"
              >
                {pending === "firebase" ? "Waiting for Google…" : "Continue with Google →"}
              </button>
            ) : null}
            {showChatGPT ? (
              <button
                type="button"
                onClick={() => startChatGPTSignIn("/studio")}
                className="flex w-full items-center justify-center rounded-lg border border-border px-4 py-3 text-sm font-semibold transition hover:bg-muted"
              >
                Continue with ChatGPT →
              </button>
            ) : null}
            <a
              href={authLoginUrl("/studio")}
              className={
                showFirebase || showChatGPT
                  ? "flex w-full items-center justify-center rounded-lg border border-border px-4 py-3 text-sm font-semibold transition hover:bg-muted"
                  : "flex w-full items-center justify-center rounded-lg bg-foreground px-4 py-3 text-sm font-semibold text-background transition hover:opacity-90"
              }
            >
              Continue with {platformLabel()} →
            </a>
          </div>
          {error ? (
            <p role="alert" className="mt-4 text-sm leading-6 text-destructive">{error}</p>
          ) : null}
          <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
            No Schematic password is stored here. Local development uses a private development session; hosted builds use the platform identity boundary.
          </p>
        </div>
      </section>
    </main>
  );
}
