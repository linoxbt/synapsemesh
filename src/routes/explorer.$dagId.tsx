import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { DAGGraph } from "@/components/DAGGraph";
import { useMesh } from "@/lib/sdk";
import { StatusPill } from "./dashboard";

export const Route = createFileRoute("/explorer/$dagId")({
  head: () => ({
    meta: [
      { title: "Task DAG - SynapseMesh Explorer" },
      { name: "description", content: "Inspect a SynapseMesh Task DAG node-by-node: agent assignment, TEE attestation score and atomic escrow release." },
    ],
  }),
  component: DagDetail,
  notFoundComponent: () => (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <div className="container-edge py-32 text-center">
        <p className="font-display text-3xl">DAG not found</p>
        <Link to="/explorer" className="btn-ghost mt-6 inline-flex">Back to explorer</Link>
      </div>
      <SiteFooter />
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <div className="container-edge py-32 text-center">
        <p className="font-display text-3xl">Could not load DAG</p>
        <p className="text-sm text-muted-foreground mt-2">{error.message}</p>
      </div>
      <SiteFooter />
    </div>
  ),
});

function DagDetail() {
  const { dagId } = Route.useParams();
  const dags = useMesh((s) => s.dags);
  const dag = dags.find((d) => d.id === dagId);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (dag && !selected && dag.nodes[0]) setSelected(dag.nodes[0].id);
  }, [dag, selected]);

  if (!dag) throw notFound();
  const node = dag.nodes.find((n) => n.id === selected) || dag.nodes[0];

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="container-edge pt-12 pb-6 border-b border-border/60">
          <Link to="/explorer" className="text-xs text-muted-foreground hover:text-accent">&larr; Explorer</Link>
          <div className="flex items-end justify-between flex-wrap gap-4 mt-3">
            <div>
              <h1 className="editorial-h1 text-3xl md:text-5xl">{dag.title}</h1>
              <p className="font-mono text-xs text-muted-foreground mt-2">{dag.id} · submitted at block {dag.block.toLocaleString()}</p>
            </div>
            <StatusPill s={dag.status} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8">
            <Stat l="Nodes" v={String(dag.nodes.length)} />
            <Stat l="Total budget" v={`${dag.totalBudget.toFixed(2)} OG`} />
            <Stat l="Locked" v={`${dag.locked.toFixed(2)} OG`} />
            <Stat l="Released" v={`${dag.released.toFixed(2)} OG`} signal />
          </div>
        </section>

        <section className="container-edge py-10 grid lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3">
            <h2 className="font-display text-2xl mb-4">Task graph</h2>
            <DAGGraph nodes={dag.nodes} edges={dag.edges} selectedId={selected} onSelect={setSelected} />
            <p className="text-xs text-muted-foreground mt-3">Click any node to inspect verification and settlement details.</p>
          </div>

          <div className="lg:col-span-2 card-soft p-6">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Node detail</p>
            <h3 className="font-display text-2xl mt-1">{node.label}</h3>
            <p className="font-mono text-xs text-muted-foreground mt-1">{node.id} · {node.type.toLowerCase()}</p>
            <div className="mt-4"><StatusPill s={node.status} /></div>

            <div className="hairline my-5" />

            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div><dt className="text-muted-foreground text-xs">Budget</dt><dd className="font-mono mt-1">{node.budget.toFixed(3)} OG</dd></div>
              <div><dt className="text-muted-foreground text-xs">Payout</dt><dd className="font-mono mt-1 text-signal">{node.payout ? `${node.payout.toFixed(3)} OG` : "-"}</dd></div>
              <div><dt className="text-muted-foreground text-xs">Agent</dt><dd className="font-mono mt-1">{node.agentName || "-"}</dd></div>
              <div><dt className="text-muted-foreground text-xs">TEE score</dt><dd className="font-mono mt-1">{node.score ?? "-"}</dd></div>
              <div className="col-span-2"><dt className="text-muted-foreground text-xs">Depends on</dt><dd className="font-mono mt-1 text-xs">{node.deps.length ? node.deps.join(", ") : "(root)"}</dd></div>
            </dl>

            {node.attestation && (
              <>
                <div className="hairline my-5" />
                <p className="text-[11px] uppercase tracking-widest text-muted-foreground">TEE attestation</p>
                <div className="mt-3 rounded-lg border border-border/60 p-3 text-xs font-mono leading-relaxed">
                  <div className="flex justify-between"><span className="text-muted-foreground">image</span><span>{node.attestation.teeImage}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">score</span><span className="text-signal">{node.attestation.score}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">payout</span><span>{node.attestation.payout.toFixed(4)} OG</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">at</span><span>{new Date(node.attestation.timestamp).toLocaleTimeString()}</span></div>
                </div>
              </>
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
    <div className="card-soft p-4">
      <p className="text-[11px] uppercase tracking-widest text-muted-foreground">{l}</p>
      <p className={`font-display text-2xl mt-1 ${signal ? "text-signal" : ""}`}>{v}</p>
    </div>
  );
}
