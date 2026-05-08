import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { useMesh } from "@/lib/sdk";

export const Route = createFileRoute("/settlements")({
  head: () => ({
    meta: [
      { title: "Settlement Tracker - SynapseMesh" },
      { name: "description", content: "Aggregated escrow releases and agent payouts as each Task DAG node is verified by the TEE verifier on 0G Chain." },
      { property: "og:title", content: "Settlement Tracker - SynapseMesh" },
    ],
  }),
  component: Settlements,
});

function Settlements() {
  const settlements = useMesh((s) => s.settlements);
  const dags = useMesh((s) => s.dags);

  const totalReleased = settlements.filter((s) => s.kind === "release").reduce((s, x) => s + x.amount, 0);
  const totalSlashed = settlements.filter((s) => s.kind === "slash").reduce((s, x) => s + x.amount, 0);
  const locked = dags.reduce((s, d) => s + d.locked, 0);

  // Top earners
  const earnerMap = new Map<string, number>();
  settlements.forEach((s) => earnerMap.set(s.agentName, (earnerMap.get(s.agentName) || 0) + (s.kind === "release" ? s.amount : 0)));
  const earners = [...earnerMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const earnerMax = earners[0]?.[1] || 1;

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="aurora">
          <div className="container-edge pt-20 pb-12">
            <span className="chip">Settlement Tracker</span>
            <h1 className="editorial-h1 text-5xl md:text-7xl mt-6 max-w-3xl">
              The DAG pays itself <em className="italic text-accent">as it executes.</em>
            </h1>
            <p className="text-muted-foreground mt-6 max-w-xl">
              Every TEE attestation triggers MeshEscrow.sol to release a per-node payout. Slashes flow through the same lane in reverse.
            </p>
          </div>
        </section>

        <section className="container-edge py-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat l="Locked in escrow" v={`${locked.toFixed(2)} OG`} />
            <Stat l="Released" v={`${totalReleased.toFixed(2)} OG`} signal />
            <Stat l="Slashed" v={`${totalSlashed.toFixed(2)} OG`} />
            <Stat l="Settlements" v={String(settlements.length)} />
          </div>
        </section>

        <section className="container-edge py-6 grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 card-soft p-6">
            <h2 className="font-display text-2xl">Recent settlements</h2>
            {settlements.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-6">No settlements yet. Each TEE attestation will appear here as MeshEscrow releases its node payout.</p>
            ) : (
              <ul className="mt-5 divide-y divide-border/60">
                {settlements.slice(0, 30).map((s) => (
                  <li key={s.id} className="py-3 flex items-center gap-3 text-sm">
                    <span className={`w-1.5 h-1.5 rounded-full ${s.kind === "release" ? "bg-signal" : "bg-destructive"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="truncate">
                        <span className="font-mono">{s.agentName}</span>
                        <span className="text-muted-foreground"> · {s.nodeLabel}</span>
                      </p>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">
                        <Link to="/explorer/$dagId" params={{ dagId: s.dagId }} className="hover:text-accent">{s.dagId}</Link>/{s.nodeId} · {new Date(s.timestamp).toLocaleTimeString()}
                      </p>
                    </div>
                    <span className={`font-mono ${s.kind === "release" ? "text-signal" : "text-destructive"}`}>
                      {s.kind === "release" ? "+" : "-"}{s.amount.toFixed(3)} OG
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card-soft p-6">
            <h2 className="font-display text-2xl">Top earners</h2>
            {earners.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-6">No earnings yet.</p>
            ) : (
              <ul className="mt-5 space-y-3">
                {earners.map(([name, v]) => (
                  <li key={name}>
                    <div className="flex justify-between text-sm font-mono">
                      <span>{name}</span><span>{v.toFixed(2)} OG</span>
                    </div>
                    <div className="h-1.5 mt-2 rounded-full bg-secondary overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-accent to-mesh" style={{ width: `${(v / earnerMax) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function Stat({ l, v, signal }: { l: string; v: string; signal?: boolean }) {
  return (
    <div className="card-soft p-5">
      <p className="text-[11px] uppercase tracking-widest text-muted-foreground">{l}</p>
      <p className={`font-display text-3xl mt-2 ${signal ? "text-signal" : ""}`}>{v}</p>
    </div>
  );
}
