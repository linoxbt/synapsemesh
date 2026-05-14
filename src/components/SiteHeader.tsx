import { Link, useLocation } from "@tanstack/react-router";
import { useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";

const links = [
  { to: "/", label: "Overview" },
  { to: "/agents", label: "Agents" },
  { to: "/explorer", label: "Explorer" },
  { to: "/dashboard", label: "Dashboard" },
  { to: "/dags/new", label: "Submit DAG" },
  { to: "/settlements", label: "Settlements" },
  { to: "/docs", label: "Docs" },
] as const;

export function SiteHeader() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 backdrop-blur-xl bg-background/70 border-b border-border/60">
      <div className="container-edge flex items-center justify-between h-16 gap-3">
        <Link to="/" className="flex items-center gap-2.5 group shrink-0">
          <span className="relative w-7 h-7 rounded-lg bg-gradient-to-br from-accent to-mesh grid place-items-center">
            <span className="block w-2 h-2 bg-background rounded-sm rotate-45" />
          </span>
          <span className="font-display text-xl tracking-tight">SynapseMesh</span>
        </Link>

        <nav className="hidden lg:flex items-center gap-0.5 mx-auto">
          {links.map((l) => {
            const active = pathname === l.to;
            return (
              <Link
                key={l.to}
                to={l.to}
                className={`px-3 py-2 rounded-full text-sm transition-colors ${
                  active ? "text-foreground bg-secondary/60" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <ConnectButton.Custom>
            {({
              account,
              chain,
              openAccountModal,
              openChainModal,
              openConnectModal,
              mounted,
            }) => {
              const ready = mounted;
              const connected = ready && account && chain;

              return (
                <div
                  {...(!ready && {
                    'aria-hidden': true,
                    style: {
                      opacity: 0,
                      pointerEvents: 'none',
                      userSelect: 'none',
                    },
                  })}
                >
                  {(() => {
                    if (!connected) {
                      return (
                        <button
                          onClick={openConnectModal}
                          type="button"
                          className="px-4 py-2 bg-accent/90 hover:bg-accent text-accent-foreground rounded-full text-sm font-medium shadow-sm transition-all"
                        >
                          Connect Wallet
                        </button>
                      );
                    }

                    if (chain.unsupported) {
                      return (
                        <button
                          onClick={openChainModal}
                          type="button"
                          className="px-4 py-2 bg-destructive/90 hover:bg-destructive text-destructive-foreground rounded-full text-sm font-medium shadow-sm transition-all"
                        >
                          Wrong Network
                        </button>
                      );
                    }

                    return (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={openChainModal}
                          className="flex items-center gap-2 px-3 py-1.5 bg-secondary/80 hover:bg-secondary rounded-full text-sm font-medium transition-all"
                          type="button"
                        >
                          {chain.hasIcon && (
                            <div
                              style={{
                                background: chain.iconBackground,
                                width: 16,
                                height: 16,
                                borderRadius: 999,
                                overflow: 'hidden',
                              }}
                            >
                              {chain.iconUrl && (
                                <img
                                  alt={chain.name ?? 'Chain icon'}
                                  src={chain.iconUrl}
                                  style={{ width: 16, height: 16 }}
                                />
                              )}
                            </div>
                          )}
                          {chain.name}
                        </button>

                        <button
                          onClick={openAccountModal}
                          type="button"
                          className="px-4 py-1.5 border border-border/80 hover:bg-secondary/50 rounded-full text-sm font-medium transition-all"
                        >
                          {account.displayName}
                        </button>
                      </div>
                    );
                  })()}
                </div>
              );
            }}
          </ConnectButton.Custom>
          <button
            className="lg:hidden p-2 rounded-md border border-border ml-2"
            onClick={() => setOpen(!open)}
            aria-label="Menu"
          >
            <span className="block w-4 h-px bg-foreground mb-1" />
            <span className="block w-4 h-px bg-foreground" />
          </button>
        </div>
      </div>
      {open && (
        <div className="lg:hidden border-t border-border bg-background">
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
