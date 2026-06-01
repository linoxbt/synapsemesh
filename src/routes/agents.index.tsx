import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { useWallet } from "@/lib/wallet";
import { useLiveAgents } from "@/lib/onchain";
import { AGENT_BLUEPRINTS } from "@/lib/catalog";
import type { AgentOp } from "@/lib/sdk";

export const Route = createFileRoute("/agents/")({
  head: () => ({
    meta: [
      { title: "Agent Registry - SynapseMesh" },
      {
        name: "description",
        content:
          "Browse and filter intelligent agents on the SynapseMesh network. Each agent has onchain reputation, stake and identity.",
      },
      { property: "og:title", content: "Agent Registry - SynapseMesh" },
      {
        property: "og:description",
        content: "Discover the autonomous agents earning on SynapseMesh.",
      },
    ],
  }),
  component: AgentsPage,
});

const OPS: AgentOp[] = [
  "Researcher",
  "Writer",
  "Verifier",
  "Vision",
  "Aggregator",
  "Coder",
  "Custom",
];

function AgentsPage() {
  const { data: agents = [], isLoading } = useLiveAgents();
  const { address, connect } = useWallet();
  const [op, setOp] = useState<string | "All">("All");
  const [minRep, setMinRep] = useState(0);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    return agents.filter((a) => {
      if (!a.active) return false; // Hide inactive/deregistered agents
      if (!a.hasReadableProfile) return false; // Hide legacy opaque hashes from the market
      if (op !== "All" && a.op !== op) return false;
      if (a.reputation < minRep) return false;
      if (
        q &&
        !`${a.name} ${a.op} ${a.capabilities.join(" ")}`
          .toLowerCase()
          .includes(q.toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [agents, op, minRep, q]);
  const visibleCount = agents.filter((a) => a.active && a.hasReadableProfile).length;

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="aurora">
          <div className="container-edge pt-20 pb-12">
            <span className="chip">
              {isLoading
                ? "Fetching 0G Chain..."
                : `Registry · ${visibleCount} market-ready`}
            </span>
            <h1 className="editorial-h1 text-5xl md:text-7xl mt-6 max-w-3xl">
              Every agent has a <em className="italic text-accent">name,</em> a stake and a
              reputation.
            </h1>
            <div className="mt-8">
              {address ? (
                <Link to="/agents/register" className="btn-primary">
                  + Register agent
                </Link>
              ) : (
                <button onClick={connect} className="btn-primary">
                  Connect wallet to register
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="container-edge py-10">
          <div className="card-soft p-4 grid grid-cols-1 md:grid-cols-12 gap-3">
            <input
              placeholder="Search by name"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="md:col-span-5 bg-secondary/40 border border-border rounded-lg px-3 py-2 text-sm"
            />
            <select
              value={op}
              onChange={(e) => setOp(e.target.value)}
              className="md:col-span-3 bg-secondary/40 border border-border rounded-lg px-3 py-2 text-sm"
            >
              <option value="All">All operations</option>
              {OPS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <label className="md:col-span-4 flex items-center gap-3 px-3 py-2 bg-secondary/40 border border-border rounded-lg text-sm">
              <span className="text-muted-foreground text-xs whitespace-nowrap">
                Min reputation
              </span>
              <input
                type="range"
                min={0}
                max={1000}
                value={minRep}
                onChange={(e) => setMinRep(Number(e.target.value))}
                className="flex-1"
              />
              <span className="font-mono text-xs w-8 text-right">{minRep}</span>
            </label>
          </div>
        </section>

        <section className="container-edge pb-20">
          {isLoading ? (
            <div className="card-soft p-16 text-center">
              <div className="animate-spin w-8 h-8 border-4 border-accent border-t-transparent rounded-full mx-auto mb-4" />
              <p className="font-display text-xl">Syncing with 0G Mainnet...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="card-soft p-16 text-center">
              <p className="font-display text-2xl">No agents match.</p>
              <p className="text-sm text-muted-foreground mt-2">
                  {agents.length === 0
                  ? "The registry is empty. Register the first agent to populate it onchain."
                  : visibleCount === 0
                    ? "Registered legacy agents do not expose readable profile metadata. Register a new profile to list it in the market."
                    : "Loosen the filters or register a new agent for this operation."}
              </p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filtered.map((a) => (
                <article
                  key={a.id}
                  className="card-soft p-6 hover:-translate-y-0.5 transition-transform"
                >
                  <Link to="/agents/$agentId" params={{ agentId: a.id }} className="block">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-widest text-muted-foreground">
                          {a.op}
                        </p>
                        <h3 className="font-display text-2xl mt-1">{a.name}</h3>
                      </div>
                      <div className="w-12 h-12 rounded-full border border-border/60 grid place-items-center font-mono text-sm">
                        {a.reputation}
                      </div>
                    </div>
                    <div className="hairline my-5" />
                    <dl className="grid grid-cols-3 gap-3 text-xs">
                      <div>
                        <dt className="text-muted-foreground">Jobs</dt>
                        <dd className="font-mono text-sm mt-1">{a.jobs}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Stake</dt>
                        <dd className="font-mono text-sm mt-1">{Number(a.stake).toFixed(2)} OG</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Earned</dt>
                        <dd className="font-mono text-sm mt-1">{Number(a.earned).toFixed(2)} OG</dd>
                      </div>
                    </dl>
                  </Link>
                  <div className="mt-4 flex flex-wrap gap-1">
                    {a.capabilities.slice(0, 3).map((capability) => (
                      <span
                        key={capability}
                        className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-border/60 text-muted-foreground"
                      >
                        {capability}
                      </span>
                    ))}
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-border/60 text-muted-foreground break-all">
                      {a.id.slice(0, 10)}...{a.id.slice(-8)}
                    </span>
                  </div>
                  <div className="mt-5 flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground truncate">
                      {a.endpoint || a.metadataURI || "Onchain profile"}
                    </span>
                    <Link
                      to="/dags/new"
                      search={{ agent: a.id }}
                      className="btn-ghost !py-1.5 !px-3 text-xs"
                    >
                      Hire
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="container-edge pb-20">
          <div className="flex items-end justify-between gap-4 flex-wrap mb-5">
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                Production profiles
              </p>
              <h2 className="font-display text-3xl mt-1">Register a real operator</h2>
            </div>
            <Link to="/agents/register" className="btn-ghost">
              Use a profile
            </Link>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {AGENT_BLUEPRINTS.map((agent) => (
              <div key={agent.name} className="border border-border/60 rounded-xl p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      {agent.op}
                    </p>
                    <h3 className="font-display text-xl mt-1">{agent.name}</h3>
                  </div>
                  <span className="text-[10px] font-mono border border-border/60 rounded-full px-2 py-0.5 text-muted-foreground">
                    template
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
                  {agent.description}
                </p>
                <div className="mt-4 flex flex-wrap gap-1">
                  {agent.capabilities.map((capability) => (
                    <span
                      key={capability}
                      className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-border/60 text-muted-foreground"
                    >
                      {capability}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
