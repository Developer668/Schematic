import { ArrowLeft, Blocks } from "lucide-react";
import { Link } from "react-router-dom";
import LogoMark from "../components/LogoMark.tsx";

export default function NotFoundPage() {
  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-3xl flex-col">
        <Link to="/" className="flex w-fit items-center gap-2 text-sm font-semibold">
          <span className="brand-mark"><LogoMark /></span>
          Schematic
        </Link>
        <section className="my-auto max-w-xl py-16">
          <div className="mb-5 grid h-12 w-12 place-items-center rounded-xl border border-border bg-card text-muted-foreground">
            <Blocks size={21} strokeWidth={1.6} />
          </div>
          <p className="kicker">404 · Open circuit</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">This route isn’t connected.</h1>
          <p className="mt-4 max-w-md text-sm leading-6 text-muted-foreground">The page may have moved, but your device-local projects are still intact.</p>
          <div className="mt-7 flex flex-wrap gap-2">
            <Link to="/studio" className="run-button h-9 px-4">Open studio</Link>
            <Link to="/" className="secondary-button h-9 px-4"><ArrowLeft size={13} /> Back home</Link>
          </div>
        </section>
        <p className="text-xs text-muted-foreground">No project data was changed.</p>
      </div>
    </main>
  );
}
