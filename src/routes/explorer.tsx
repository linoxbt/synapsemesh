import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { useLiveDAGs } from "@/lib/onchain";

export const Route = createFileRoute("/explorer")({
  head: () => ({
    meta: [
      { title: "DAG Explorer - SynapseMesh" },
      { name: "description", content: "Explore every Task DAG on the SynapseMesh network. Click into any DAG to inspect node-level execution, verification and settlement." },
      { property: "og:title", content: "DAG Explorer - SynapseMesh" },
    ],
  }),
  component: ExplorerPage,
});

function ExplorerPage() {
  const { data: dags = [], isLoading } = useLiveDAGs();
  const [filter, setFilter] = useState<string>("All");

  const filtered = useMemo(() => {
    if (filter === "All") return dags;
    if (filter === "Completed") return dags.filter((d) => d.complete);
    if (filter === "Active") return dags.filter((d) => !d.complete);
    return dags;
  }, [dags, filter]);

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="aurora">
          <div className="container-edge pt-20 pb-12">
            <span className="chip">
              {isLoading ? "Fetching 0G Chain..." : `Explorer · ${dags.length} DAGs`}
            </span>
            <h1 className="editorial-h1 text-5xl md:text-7xl mt-6 max-w-3xl">
              Every DAG, every node, <em className="italic text-accent">verifiable.</em>
            </h1>
            <p className="text-muted-foreground mt-6 max-w-xl">
              Each Task DAG is committed onchain via TaskDAGRegistry.sol. Click any DAG to see its graph, per-node TEE attestations and atomic settlement trail.
            </p>
          </div>
        </section>

        <section className="container-edge py-10">
          <div className="flex gap-2 text-xs flex-wrap">
            {["All", "Active", "Completed"].map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`px-3 py-1.5 rounded-full border ${filter === s ? "bg-secondary border-border text-foreground" : "border-border/60 text-muted-foreground hover:text-foreground"}`}
              >
                {s}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="card-soft p-16 text-center mt-8">
              <div className="animate-spin w-8 h-8 border-4 border-accent border-t-transparent rounded-full mx-auto mb-4" />
              <p className="font-display text-xl">Syncing DAGs with 0G Mainnet...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="card-soft p-16 text-center mt-8">
              <p className="font-display text-2xl">No DAGs to explore yet</p>
              <p className="text-sm text-muted-foreground mt-2">Submit a DAG from the dashboard to see it here.</p>
              <Link to="/dags/new" className="btn-primary mt-6 inline-flex">Submit a Task DAG</Link>
            </div>
          ) : (
            <ul className="mt-8 grid md:grid-cols-2 gap-4">
              {filtered.map((d) => (
                <li key={d.id}>
                  <Link to="/explorer/$dagId" params={{ dagId: d.id }} className="card-soft p-6 block hover:-translate-y-0.5 transition-transform">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-display text-xl truncate">{d.title}</p>
                        <p className="font-mono text-[10px] text-muted-foreground mt-1 truncate">{d.id}</p>
                      </div>
                      <span className={`px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest rounded-full border ${d.complete ? 'border-signal text-signal bg-signal/10' : 'border-accent text-accent bg-accent/10'}`}>
                        {d.complete ? 'Completed' : 'Active'}
                      </span>
                    </div>
                    <div className="hairline my-5" />
                    <dl className="grid grid-cols-4 gap-2 text-xs">
                      <div className="col-span-2"><dt className="text-muted-foreground">Requester</dt><dd className="font-mono mt-1 text-[10px] truncate">{d.owner}</dd></div>
                      <div><dt className="text-muted-foreground">Nodes</dt><dd className="font-mono mt-1">{d.nodeCount}</dd></div>
                      <div><dt className="text-muted-foreground">Budget</dt><dd className="font-mono mt-1">{Number(d.totalBudget).toFixed(2)} OG</dd></div>
                    </dl>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
