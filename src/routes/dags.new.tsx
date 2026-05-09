import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { mesh, type NodeType } from "@/lib/sdk";
import { useWallet } from "@/lib/wallet";

export const Route = createFileRoute("/dags/new")({
  head: () => ({
    meta: [
      { title: "Submit Task DAG - SynapseMesh" },
      { name: "description", content: "Compose a Task DAG and submit it on-chain via the wallet-connected SDK on 0G Chain." },
      { property: "og:title", content: "Submit Task DAG - SynapseMesh" },
      { property: "og:description", content: "Lock budget into MeshEscrow.sol and let agents bid, execute and settle." },
    ],
  }),
  component: NewDagPage,
});

const TYPES: NodeType[] = ["SEQUENTIAL", "PARALLEL", "CONDITIONAL", "REDUCE"];

interface DraftNode {
  id: string;
  label: string;
  type: NodeType;
  budget: number;
  deps: string[]; // labels of upstream nodes
}

function uid() { return Math.random().toString(36).slice(2, 8); }

function NewDagPage() {
  const { address, connect, isCorrectChain, switchToZg } = useWallet();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [nodes, setNodes] = useState<DraftNode[]>([
    { id: uid(), label: "Research", type: "SEQUENTIAL", budget: 1, deps: [] },
  ]);

  const totalBudget = nodes.reduce((s, n) => s + (Number(n.budget) || 0), 0);
  const labels = nodes.map((n) => n.label).filter(Boolean);

  const update = (id: string, patch: Partial<DraftNode>) =>
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  const remove = (id: string) => setNodes((ns) => ns.filter((n) => n.id !== id));
  const add = () => setNodes((ns) => [...ns, { id: uid(), label: `Node ${ns.length + 1}`, type: "SEQUENTIAL", budget: 1, deps: [] }]);

  const canSubmit = !!address && isCorrectChain && title.trim().length > 0
    && nodes.length > 0 && nodes.every((n) => n.label.trim() && n.budget > 0)
    && new Set(labels).size === labels.length;

  const submit = () => {
    if (!canSubmit) return;
    const dag = mesh.dags.submit({
      title: title.trim(),
      owner: address!,
      nodes: nodes.map((n) => ({
        label: n.label.trim(),
        type: n.type,
        budget: Number(n.budget),
        deps: n.deps,
      })),
    });
    navigate({ to: "/explorer/$dagId", params: { dagId: dag.id } });
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="aurora">
          <div className="container-edge pt-20 pb-10">
            <span className="chip">Compose</span>
            <h1 className="editorial-h1 text-4xl md:text-6xl mt-6 max-w-3xl">
              Submit a Task DAG <em className="italic text-accent">on-chain.</em>
            </h1>
            <p className="text-muted-foreground mt-5 max-w-xl text-sm">
              Define each node, its budget and dependencies. Submitting calls TaskDAG.submit() and locks total budget in MeshEscrow.sol via the wallet-connected SDK.
            </p>
          </div>
        </section>

        <section className="container-edge py-10 grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 card-soft p-6">
            <label className="block text-xs uppercase tracking-widest text-muted-foreground">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Quarterly research pipeline"
              className="w-full mt-2 bg-secondary/40 border border-border rounded-lg px-3 py-2 text-sm"
            />

            <div className="flex items-center justify-between mt-8 mb-3">
              <h2 className="font-display text-xl">Nodes</h2>
              <button onClick={add} className="btn-ghost !py-1.5 !px-3 text-xs">+ Add node</button>
            </div>

            <ul className="space-y-3">
              {nodes.map((n, i) => (
                <li key={n.id} className="border border-border/60 rounded-xl p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="font-mono text-xs text-muted-foreground">#{i + 1}</span>
                    <input
                      value={n.label}
                      onChange={(e) => update(n.id, { label: e.target.value })}
                      placeholder="Label"
                      className="flex-1 bg-secondary/40 border border-border rounded-lg px-2 py-1.5 text-sm"
                    />
                    <button
                      onClick={() => remove(n.id)}
                      disabled={nodes.length === 1}
                      className="text-xs text-muted-foreground hover:text-destructive disabled:opacity-30"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="grid sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest text-muted-foreground">Type</label>
                      <select
                        value={n.type}
                        onChange={(e) => update(n.id, { type: e.target.value as NodeType })}
                        className="w-full mt-1 bg-secondary/40 border border-border rounded-lg px-2 py-1.5 text-sm"
                      >
                        {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest text-muted-foreground">Budget (OG)</label>
                      <input
                        type="number" step="0.1" min="0"
                        value={n.budget}
                        onChange={(e) => update(n.id, { budget: Number(e.target.value) })}
                        className="w-full mt-1 bg-secondary/40 border border-border rounded-lg px-2 py-1.5 text-sm font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest text-muted-foreground">Depends on</label>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {nodes.filter((m) => m.id !== n.id && m.label.trim()).map((m) => {
                          const on = n.deps.includes(m.label);
                          return (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => update(n.id, { deps: on ? n.deps.filter((d) => d !== m.label) : [...n.deps, m.label] })}
                              className={`text-[10px] font-mono px-2 py-0.5 rounded-full border transition-colors ${
                                on ? "border-accent text-accent bg-accent/5" : "border-border/60 text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {m.label}
                            </button>
                          );
                        })}
                        {nodes.length === 1 && <span className="text-[10px] text-muted-foreground">No upstream nodes</span>}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <aside className="card-soft p-6 h-fit lg:sticky lg:top-24">
            <h3 className="font-display text-xl">Summary</h3>
            <dl className="mt-5 space-y-3 text-sm">
              <Row k="Nodes" v={String(nodes.length)} />
              <Row k="Total budget" v={`${totalBudget.toFixed(2)} OG`} />
              <Row k="Owner" v={address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Not connected"} />
              <Row k="Chain" v={isCorrectChain ? "0G Galileo" : "Wrong network"} />
            </dl>
            <div className="hairline my-5" />
            {!address ? (
              <button onClick={connect} className="btn-primary w-full">Connect wallet</button>
            ) : !isCorrectChain ? (
              <button onClick={switchToZg} className="btn-primary w-full">Switch to 0G</button>
            ) : (
              <button
                onClick={submit}
                disabled={!canSubmit}
                className="btn-primary w-full disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Lock {totalBudget.toFixed(2)} OG &amp; submit
              </button>
            )}
            <p className="text-[11px] text-muted-foreground mt-3">
              Calls TaskDAG.submit() then MeshEscrow.lock() in a single tx.
            </p>
          </aside>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-mono text-right">{v}</dd>
    </div>
  );
}
