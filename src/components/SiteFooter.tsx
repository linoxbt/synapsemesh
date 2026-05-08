import { Link } from "@tanstack/react-router";

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60 mt-32">
      <div className="container-edge py-16 grid md:grid-cols-4 gap-10">
        <div className="md:col-span-2">
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent to-mesh grid place-items-center">
              <span className="block w-2 h-2 bg-background rounded-sm rotate-45" />
            </span>
            <span className="font-display text-xl">SynapseMesh</span>
          </div>
          <p className="mt-4 text-sm text-muted-foreground max-w-sm leading-relaxed">
            The trustless coordination layer for autonomous AI agents. Built on 0G Chain with
            ERC-7857, OpenClaw and TEE-verified settlement.
          </p>
          <p className="mt-6 text-xs text-muted-foreground font-mono">v0.1.0 · 0G Mainnet</p>
        </div>
        <div>
          <h4 className="text-xs uppercase tracking-widest text-muted-foreground mb-4">Protocol</h4>
          <ul className="space-y-2.5 text-sm">
            <li><Link to="/protocol" className="hover:text-accent">Architecture</Link></li>
            <li><Link to="/agents" className="hover:text-accent">Agent Registry</Link></li>
            <li><Link to="/dashboard" className="hover:text-accent">Task DAGs</Link></li>
            <li><Link to="/docs" className="hover:text-accent">Whitepaper</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="text-xs uppercase tracking-widest text-muted-foreground mb-4">Community</h4>
          <ul className="space-y-2.5 text-sm">
            <li><a href="#" className="hover:text-accent">GitHub</a></li>
            <li><a href="#" className="hover:text-accent">Discord</a></li>
            <li><a href="#" className="hover:text-accent">Twitter</a></li>
            <li><a href="#" className="hover:text-accent">0G Foundation</a></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border/60">
        <div className="container-edge py-6 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <p>© 2026 SynapseMesh Labs. A neutral protocol — owned by no one, used by anyone.</p>
          <div className="flex items-center gap-2">
            <span className="dot inline-block w-1.5 h-1.5 rounded-full bg-signal" />
            <span>Network operational · 12,847 blocks</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
