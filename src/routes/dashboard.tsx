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
  const agents = useMesh((s) => s.agents);
  const block = useMesh((s) => s.block);

  // Individual filtering
  const myDags = address ? dags.filter(d => d.owner.toLowerCase() === address.toLowerCase()) : [];
  const myAgents = address ? agents.filter(a => a.owner.toLowerCase() === address.toLowerCase()) : [];
  
  const locked = myDags.reduce((s, d) => s + d.locked, 0);
  const released = myDags.reduce((s, d) => s + d.released, 0);
  const executing = myDags.filter((d) => d.status === "Executing" || d.status === "Bidding").length;

  const stats = [
    { l: "My Locked OG", v: `${locked.toFixed(2)} OG` },
    { l: "My Released OG", v: `${released.toFixed(2)} OG` },
    { l: "My Active DAGs", v: String(executing) },
    { l: "My Agents", v: String(myAgents.length) },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="container-edge pt-12 pb-8 border-b border-border/60">
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div>
              <span className="chip"><span className="dot pulse-dot" /> Connected · block {block.toLocaleString()}</span>
              <h1 className="editorial-h1 text-4xl md:text-5xl mt-4">Personal Dashboard</h1>
            </div>
            {address ? (
              <div className="flex gap-2">
                <Link to="/agents/register" className="btn-ghost">Register Agent</Link>
                <Link to="/dags/new" className="btn-primary">+ New Task DAG</Link>
              </div>
            ) : (
              <button className="btn-primary" onClick={connect}>Connect Wallet</button>
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

        <section className="container-edge py-12 grid lg:grid-cols-2 gap-6">
          <div className="card-soft p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display text-2xl">My Task DAGs</h2>
              <Link to="/explorer" className="text-xs text-muted-foreground hover:text-accent">View all -&gt;</Link>
            </div>
            {!address ? (
              <div className="py-10 text-center border border-dashed border-border rounded-xl">
                 <p className="text-sm text-muted-foreground">Connect wallet to see your DAGs</p>
              </div>
            ) : myDags.length === 0 ? (
              <EmptyDags hasWallet={!!address} onConnect={connect} />
            ) : (
              <ul className="divide-y divide-border/60">
                {myDags.map((t) => (
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
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display text-2xl">My Registered Agents</h2>
              <Link to="/agents" className="text-xs text-muted-foreground hover:text-accent">Registry -&gt;</Link>
            </div>
            {!address ? (
               <div className="py-10 text-center border border-dashed border-border rounded-xl">
                 <p className="text-sm text-muted-foreground">Connect wallet to see your agents</p>
               </div>
            ) : myAgents.length === 0 ? (
              <div className="py-14 text-center">
                <p className="font-display text-xl text-muted-foreground">No agents registered</p>
                <Link to="/agents/register" className="btn-ghost mt-4 inline-block">Register your first agent</Link>
              </div>
            ) : (
              <ul className="divide-y divide-border/60">
                {myAgents.map((a) => (
                  <li key={a.id}>
                    <Link to="/agents/$agentId" params={{ agentId: a.id }} className="py-4 flex items-center gap-4 hover:bg-secondary/30 -mx-2 px-2 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <p className="font-display text-lg truncate">{a.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 uppercase tracking-wider">{a.op} · Stake: {a.stake} OG</p>
                      </div>
                      <div className="text-right text-sm">
                        <div className="w-10 h-10 rounded-full border border-border/60 grid place-items-center font-mono text-xs ml-auto">
                          {a.reputation}
                        </div>
                      </div>
                    </Link>
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

function StreamPill({ status }: { status: string }) {
  const tone = status === "live" ? "text-signal border-signal/40"
    : status === "error" ? "text-destructive border-destructive/40"
    : status === "unconfigured" ? "text-muted-foreground border-border"
    : "text-accent border-accent/40";
  const label = status === "live" ? "live"
    : status === "error" ? "reconnecting"
    : status === "unconfigured" ? "not configured"
    : "connecting";
  return (
    <span className={`chip text-[10px] ${tone}`}>
      <span className={`dot ${status === "live" ? "pulse-dot" : ""}`} /> {label}
    </span>
  );
}

function EmptyDags({ hasWallet, onConnect }: { hasWallet: boolean; onConnect: () => void }) {
  return (
    <div className="py-14 text-center">
      <p className="font-display text-2xl">No Task DAGs yet</p>
      <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto">
        Submit a DAG to lock budget in MeshEscrow and watch agents bid, execute and settle onchain.
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

