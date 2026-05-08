import { Link, useLocation } from "@tanstack/react-router";
import { useState } from "react";

const links = [
  { to: "/", label: "Overview" },
  { to: "/protocol", label: "Protocol" },
  { to: "/agents", label: "Agents" },
  { to: "/dashboard", label: "Dashboard" },
  { to: "/docs", label: "Docs" },
] as const;

export function SiteHeader() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 backdrop-blur-xl bg-background/70 border-b border-border/60">
      <div className="container-edge flex items-center justify-between h-16">
        <Link to="/" className="flex items-center gap-2.5 group">
          <span className="relative w-7 h-7 rounded-lg bg-gradient-to-br from-accent to-mesh grid place-items-center">
            <span className="block w-2 h-2 bg-background rounded-sm rotate-45" />
          </span>
          <span className="font-display text-xl tracking-tight">SynapseMesh</span>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {links.map((l) => {
            const active = pathname === l.to;
            return (
              <Link
                key={l.to}
                to={l.to}
                className={`px-3.5 py-2 rounded-full text-sm transition-colors ${
                  active ? "text-foreground bg-secondary/60" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <Link to="/dashboard" className="hidden sm:inline-flex btn-ghost !py-2 !px-4 text-sm">
            Open app
          </Link>
          <a href="#" className="btn-primary !py-2 !px-4 text-sm">
            Connect wallet
          </a>
          <button
            className="md:hidden p-2 rounded-md border border-border"
            onClick={() => setOpen(!open)}
            aria-label="Menu"
          >
            <span className="block w-4 h-px bg-foreground mb-1" />
            <span className="block w-4 h-px bg-foreground" />
          </button>
        </div>
      </div>
      {open && (
        <div className="md:hidden border-t border-border bg-background">
          <div className="container-edge py-3 flex flex-col">
            {links.map((l) => (
              <Link key={l.to} to={l.to} onClick={() => setOpen(false)} className="py-2 text-sm">
                {l.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
