import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { DAGGraph } from "@/components/DAGGraph";
import { useLiveDAGs, useDAGDetails } from "@/lib/onchain";

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
  
  const { data: dags = [] } = useLiveDAGs();
  const dag = dags.find((d) => d.id === dagId);
  
  const { data: details, isLoading } = useDAGDetails(dagId);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (details?.nodes && details.nodes.length > 0 && !selected) {
      setSelected(details.nodes[0].id);
    }
  }, [details, selected]);

  if (!dag && dags.length > 0) throw notFound();
  
  const node = details?.nodes?.find((n) => n.id === selected) || details?.nodes?.[0];

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="container-edge pt-12 pb-6 border-b border-border/60">
          <Link to="/explorer" className="text-xs text-muted-foreground hover:text-accent">&larr; Explorer</Link>
          <div className="flex items-end justify-between flex-wrap gap-4 mt-3">
            <div>
              <h1 className="editorial-h1 text-3xl md:text-5xl">{dag?.title || "Loading..."}</h1>
              <p className="font-mono text-xs text-muted-foreground mt-2">{dag?.id} · submitted at block {dag?.submittedAtBlock}</p>
            </div>
            <span className={`px-3 py-1 text-xs font-mono uppercase tracking-widest rounded-full border ${dag?.complete ? 'border-signal text-signal bg-signal/10' : 'border-accent text-accent bg-accent/10'}`}>
              {dag?.complete ? 'Completed' : 'Active'}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8">
            <Stat l="Nodes" v={String(dag?.nodeCount || 0)} />
            <Stat l="Total budget" v={`${Number(dag?.totalBudget || 0).toFixed(2)} OG`} />
            <Stat l="Locked" v={dag?.complete ? "0.00 OG" : `${Number(dag?.totalBudget || 0).toFixed(2)} OG`} />
            <Stat l="Released" v={dag?.complete ? `${Number(dag?.totalBudget || 0).toFixed(2)} OG` : "0.00 OG"} signal />
          </div>
        </section>

        <section className="container-edge py-10 grid lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3">
            <h2 className="font-display text-2xl mb-4">Task graph</h2>
            {isLoading ? (
              <div className="card-soft p-10 flex items-center justify-center min-h-[380px]">
                 <div className="animate-spin w-6 h-6 border-2 border-accent border-t-transparent rounded-full" />
              </div>
            ) : (
              <DAGGraph nodes={details?.nodes as any || []} edges={details?.edges || []} selectedId={selected} onSelect={setSelected} />
            )}
            <p className="text-xs text-muted-foreground mt-3">Click any node to inspect verification and settlement details.</p>
          </div>

          <div className="lg:col-span-2 card-soft p-6">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Node detail</p>
            {!node ? (
              <p className="mt-4 text-sm text-muted-foreground">Select a node to view details.</p>
            ) : (
              <>
                <h3 className="font-display text-2xl mt-1">{node.label}</h3>
                <p className="font-mono text-[10px] text-muted-foreground mt-1 truncate">{node.id} · {node.type.toLowerCase()}</p>
                <div className="mt-4">
                  <span className={`inline-block text-[10px] uppercase tracking-widest border rounded-full px-2 py-0.5 ${node.status === 'Settled' ? 'border-signal text-signal' : node.status === 'Failed' ? 'border-destructive text-destructive' : 'border-accent text-accent'}`}>
                    {node.status}
                  </span>
                </div>

                <div className="hairline my-5" />

                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <div><dt className="text-muted-foreground text-xs">Budget</dt><dd className="font-mono mt-1">{node.budget.toFixed(3)} OG</dd></div>
                  <div><dt className="text-muted-foreground text-xs">Payout</dt><dd className="font-mono mt-1 text-signal">{node.payout ? `${node.payout.toFixed(3)} OG` : "-"}</dd></div>
                  <div className="col-span-2"><dt className="text-muted-foreground text-xs">Assigned Agent</dt><dd className="font-mono mt-1 truncate text-xs">{node.agentId || "-"}</dd></div>
                  <div className="col-span-2"><dt className="text-muted-foreground text-xs">TEE Verification Score</dt><dd className="font-mono mt-1 text-accent">{node.score ?? "-"}</dd></div>
                </dl>
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
