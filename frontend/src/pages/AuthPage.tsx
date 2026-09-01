import { Link } from "react-router-dom";
import LogoMark from "../components/LogoMark";
import { authLoginUrl, getAuthMode } from "../auth/session";

function authLabel() {
  if (getAuthMode() === "browser") return "browser workspace";
  return getAuthMode() === "chatgpt-sites" ? "ChatGPT" : "workspace";
}

export default function AuthPage() {
  const label = authLabel();

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
            {getAuthMode() === "browser"
              ? "This public demo keeps projects in this browser. Native WebMCP tools are available when the page is opened by a compatible browser agent."
              : <>Sign-in is handled by your {label} identity. Your projects, WebMCP actions, and preview sessions are scoped to that verified account.</>}
          </p>
          <a
            href={authLoginUrl("/studio")}
            className="mt-7 flex w-full items-center justify-center rounded-lg bg-foreground px-4 py-3 text-sm font-semibold text-background transition hover:opacity-90"
          >
            Continue with {label} →
          </a>
          <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
            No Schematic password is stored here. Vercel demo builds use a browser-local workspace; ChatGPT Sites and Cloudflare builds use their platform identity boundary.
          </p>
        </div>
      </section>
    </main>
  );
}
