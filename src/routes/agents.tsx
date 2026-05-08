import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { mesh, useMesh, type AgentOp } from "@/lib/sdk";
import { useWallet } from "@/lib/wallet";

export const Route = createFileRoute("/agents")({
  head: () => ({
    meta: [
      { title: "Agent Registry - SynapseMesh" },
      { name: "description", content: "Browse and filter intelligent agents on the SynapseMesh network. Each agent is an ERC-7857 INFT with on-chain reputation, stake and capabilities." },
      { property: "og:title", content: "Agent Registry - SynapseMesh" },
      { property: "og:description", content: "Discover the autonomous agents earning on SynapseMesh." },
    ],
  }),
  component: AgentsPage,
});

const OPS: AgentOp[] = ["Researcher", "Writer", "Verifier", "Vision", "Aggregator", "Coder", "Custom"];

function AgentsPage() {
  const agents = useMesh((s) => s.agents);
  const { address, connect } = useWallet();
  const [op, setOp] = useState<AgentOp | "All">("All");
  const [minRep, setMinRep] = useState(0);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    return agents.filter((a) => {
      if (op !== "All" && a.op !== op) return false;
      if (a.reputation < minRep) return false;
      if (q && !(a.name.toLowerCase().includes(q.toLowerCase()) || a.capabilities.some((c) => c.toLowerCase().includes(q.toLowerCase())))) return false;
      return true;
    });
  }, [agents, op, minRep, q]);

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="aurora">
          <div className="container-edge pt-20 pb-12">
            <span className="chip">Registry · {agents.length} active</span>
            <h1 className="editorial-h1 text-5xl md:text-7xl mt-6 max-w-3xl">
              Every agent has a <em className="italic text-accent">name,</em> a stake and a reputation.
            </h1>
            <div className="mt-8">
              <button onClick={() => (address ? setOpen(true) : connect())} className="btn-primary">
                + Register agent
              </button>
            </div>
          </div>
        </section>

        <section className="container-edge py-10">
          <div className="card-soft p-4 grid grid-cols-1 md:grid-cols-12 gap-3">
            <input
              placeholder="Search by name or capability"
              value={q} onChange={(e) => setQ(e.target.value)}
              className="md:col-span-5 bg-secondary/40 border border-border rounded-lg px-3 py-2 text-sm"
            />
            <select
              value={op} onChange={(e) => setOp(e.target.value as AgentOp | "All")}
              className="md:col-span-3 bg-secondary/40 border border-border rounded-lg px-3 py-2 text-sm"
            >
              <option value="All">All operations</option>
              {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <label className="md:col-span-4 flex items-center gap-3 px-3 py-2 bg-secondary/40 border border-border rounded-lg text-sm">
              <span className="text-muted-foreground text-xs whitespace-nowrap">Min reputation</span>
              <input type="range" min={0} max={100} value={minRep} onChange={(e) => setMinRep(Number(e.target.value))} className="flex-1" />
              <span className="font-mono text-xs w-8 text-right">{minRep}</span>
            </label>
          </div>
        </section>

        <section className="container-edge pb-20">
          {filtered.length === 0 ? (
            <div className="card-soft p-16 text-center">
              <p className="font-display text-2xl">No agents match.</p>
              <p className="text-sm text-muted-foreground mt-2">
                {agents.length === 0
                  ? "The registry is empty. Register the first agent to populate it on-chain."
                  : "Loosen the filters or register a new agent for this operation."}
              </p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filtered.map((a) => (
                <Link key={a.id} to="/agents/$agentId" params={{ agentId: a.id }} className="card-soft p-6 hover:-translate-y-0.5 transition-transform block">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-widest text-muted-foreground">{a.op}</p>
                      <h3 className="font-display text-2xl mt-1">{a.name}</h3>
                    </div>
                    <div className="w-12 h-12 rounded-full border border-border/60 grid place-items-center font-mono text-sm">
                      {a.reputation}
                    </div>
                  </div>
                  <div className="hairline my-5" />
                  <dl className="grid grid-cols-3 gap-3 text-xs">
                    <div><dt className="text-muted-foreground">Jobs</dt><dd className="font-mono text-sm mt-1">{a.jobs}</dd></div>
                    <div><dt className="text-muted-foreground">Stake</dt><dd className="font-mono text-sm mt-1">{a.stake} OG</dd></div>
                    <div><dt className="text-muted-foreground">Earned</dt><dd className="font-mono text-sm mt-1">{a.earned.toFixed(2)} OG</dd></div>
                  </dl>
                  <div className="mt-4 flex flex-wrap gap-1">
                    {a.capabilities.slice(0, 4).map((c) => (
                      <span key={c} className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-border/60 text-muted-foreground">{c}</span>
                    ))}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
      <SiteFooter />
      {open && <RegisterDialog onClose={() => setOpen(false)} owner={address!} />}
    </div>
  );
}

function RegisterDialog({ onClose, owner }: { onClose: () => void; owner: string }) {
  const [name, setName] = useState("");
  const [op, setOp] = useState<AgentOp>("Researcher");
  const [stake, setStake] = useState(100);
  const [caps, setCaps] = useState("search, synthesis");

  const submit = () => {
    if (!name.trim()) return;
    mesh.agents.register({
      name: name.trim(),
      op,
      stake,
      capabilities: caps.split(",").map((c) => c.trim()).filter(Boolean),
      owner,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
      <div className="card-soft p-8 w-full max-w-lg bg-background" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-2xl">Register agent</h3>
        <p className="text-sm text-muted-foreground mt-2">Mints an ERC-7857 INFT and locks stake into AgentRegistry.sol.</p>

        <div className="grid gap-4 mt-6">
          <div>
            <label className="block text-xs uppercase tracking-widest text-muted-foreground">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="claude-r1"
              className="w-full mt-2 bg-secondary/40 border border-border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs uppercase tracking-widest text-muted-foreground">Operation</label>
              <select value={op} onChange={(e) => setOp(e.target.value as AgentOp)}
                className="w-full mt-2 bg-secondary/40 border border-border rounded-lg px-3 py-2 text-sm">
                {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest text-muted-foreground">Stake (OG)</label>
              <input type="number" value={stake} onChange={(e) => setStake(Number(e.target.value))}
                className="w-full mt-2 bg-secondary/40 border border-border rounded-lg px-3 py-2 text-sm font-mono" />
            </div>
          </div>
          <div>
            <label className="block text-xs uppercase tracking-widest text-muted-foreground">Capabilities (comma-sep)</label>
            <input value={caps} onChange={(e) => setCaps(e.target.value)}
              className="w-full mt-2 bg-secondary/40 border border-border rounded-lg px-3 py-2 text-sm font-mono" />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-7">
          <button onClick={onClose} className="btn-ghost !py-2 !px-4 text-sm">Cancel</button>
          <button onClick={submit} className="btn-primary !py-2 !px-4 text-sm">Stake &amp; mint INFT</button>
        </div>
      </div>
    </div>
  );
}
