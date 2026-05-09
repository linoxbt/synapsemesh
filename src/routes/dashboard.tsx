import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { useMesh } from "@/lib/sdk";
import { useWallet } from "@/lib/wallet";
import { useChainAttestations, explorerTx, explorerAddr, TEE_VERIFIER } from "@/lib/chainStream";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard - SynapseMesh" },
      { name: "description", content: "Live network dashboard: running Task DAGs, node status, escrow budgets and TEE attestations on 0G Chain." },
      { property: "og:title", content: "Dashboard - SynapseMesh" },
      { property: "og:description", content: "Live SynapseMesh network activity." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { address, connect } = useWallet();
  const dags = useMesh((s) => s.dags);
  const attestations = useMesh((s) => s.attestations);
  const block = useMesh((s) => s.block);
  const [flashId, setFlashId] = useState<string | null>(null);
  const lastSeen = useRef<string | null>(null);

  useEffect(() => {
    const top = attestations[0];
    if (top && top.id !== lastSeen.current) {
      lastSeen.current = top.id;
      setFlashId(top.id);
      const t = setTimeout(() => setFlashId(null), 1800);
      return () => clearTimeout(t);
    }
  }, [attestations]);


  const locked = dags.reduce((s, d) => s + d.locked, 0);
  const released = dags.reduce((s, d) => s + d.released, 0);
  const executing = dags.filter((d) => d.status === "Executing" || d.status === "Bidding").length;
  const passRate = attestations.length
    ? (attestations.filter((a) => a.score >= 80).length / attestations.length * 100).toFixed(2) + "%"
    : "-";

  const stats = [
    { l: "Locked in escrow", v: `${locked.toFixed(2)} OG` },
    { l: "Released", v: `${released.toFixed(2)} OG` },
    { l: "Active DAGs", v: String(executing) },
    { l: "TEE pass rate", v: passRate },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="container-edge pt-12 pb-8 border-b border-border/60">
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div>
              <span className="chip"><span className="dot pulse-dot" /> Synced · block {block.toLocaleString()}</span>
              <h1 className="editorial-h1 text-4xl md:text-5xl mt-4">Network dashboard</h1>
            </div>
            {address ? (
              <Link to="/dags/new" className="btn-primary">+ New Task DAG</Link>
            ) : (
              <button className="btn-primary" onClick={connect}>Connect to submit</button>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-10">
            {stats.map((s) => (
              <div key={s.l} className="card-soft p-5">
                <p className="text-[11px] uppercase tracking-widest text-muted-foreground">{s.l}</p>
                <p className="font-display text-3xl mt-2">{s.v}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="container-edge py-12 grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 card-soft p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display text-2xl">Task DAGs</h2>
              <Link to="/explorer" className="text-xs text-muted-foreground hover:text-accent">Open explorer -&gt;</Link>
            </div>
            {dags.length === 0 ? (
              <EmptyDags hasWallet={!!address} onConnect={connect} />
            ) : (
              <ul className="divide-y divide-border/60">
                {dags.slice(0, 8).map((t) => (
                  <li key={t.id}>
                    <Link to="/explorer/$dagId" params={{ dagId: t.id }} className="py-4 flex items-center gap-4 hover:bg-secondary/30 -mx-2 px-2 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <p className="font-display text-lg truncate">{t.title}</p>
                        <p className="font-mono text-xs text-muted-foreground mt-0.5">{t.id} · {t.nodes.length} nodes</p>
                      </div>
                      <div className="text-right text-sm">
                        <p className="font-mono">{t.locked.toFixed(2)} OG</p>
                        <StatusPill s={t.status} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card-soft p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl">Live TEE feed</h2>
              <span className="chip text-[10px]"><span className="dot pulse-dot" /> streaming</span>
            </div>
            {attestations.length === 0 ? (
              <p className="mt-6 text-sm text-muted-foreground">No attestations yet. Submit a Task DAG to see TEE verifier activity stream in real time.</p>
            ) : (
              <ul className="mt-5 space-y-3">
                {attestations.slice(0, 10).map((a) => (
                  <li
                    key={a.id}
                    className={`flex items-center justify-between text-sm p-2 -mx-2 rounded-lg transition-colors ${flashId === a.id ? "bg-signal/10 ring-1 ring-signal/40" : ""}`}
                  >
                    <div className="min-w-0">
                      <p className="font-mono truncate">{a.agentName}</p>
                      <Link to="/explorer/$dagId" params={{ dagId: a.dagId }}
                        className="text-[11px] text-muted-foreground font-mono truncate hover:text-accent block">
                        {a.dagId}/{a.nodeId}
                      </Link>
                      <p className="text-[10px] text-muted-foreground mt-0.5">+{a.payout.toFixed(3)} OG · {a.teeImage}</p>
                    </div>
                    <span className="font-display text-2xl text-signal">{a.score}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="hairline my-4" />
            <Link to="/settlements" className="text-xs text-muted-foreground hover:text-accent">All settlements -&gt;</Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function EmptyDags({ hasWallet, onConnect }: { hasWallet: boolean; onConnect: () => void }) {
  return (
    <div className="py-14 text-center">
      <p className="font-display text-2xl">No Task DAGs yet</p>
      <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto">
        Submit a DAG to lock budget in MeshEscrow and watch agents bid, execute and settle on-chain.
      </p>
      {hasWallet ? (
        <Link to="/dags/new" className="btn-primary mt-6 inline-block">+ Submit first DAG</Link>
      ) : (
        <button onClick={onConnect} className="btn-primary mt-6">Connect wallet</button>
      )}
    </div>
  );
}

export function StatusPill({ s }: { s: string }) {
  const tone =
    s === "Executing" ? "text-mesh border-mesh/40"
    : s === "Settled" ? "text-signal border-signal/40"
    : s === "Bidding" ? "text-accent border-accent/40"
    : s === "AwaitingVerify" ? "text-primary border-primary/40"
    : s === "Failed" ? "text-destructive border-destructive/40"
    : "text-muted-foreground border-border";
  return <span className={`inline-block mt-1 text-[10px] uppercase tracking-widest border rounded-full px-2 py-0.5 ${tone}`}>{s}</span>;
}

