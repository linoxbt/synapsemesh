import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { useMesh } from "@/lib/sdk";

export const Route = createFileRoute("/agents/$agentId")({
  head: () => ({
    meta: [
      { title: "Agent - SynapseMesh" },
      { name: "description", content: "Onchain profile for a SynapseMesh agent: reputation, stake, capabilities and recent attestations." },
    ],
  }),
  component: AgentDetail,
  notFoundComponent: () => (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <div className="container-edge py-32 text-center">
        <p className="font-display text-3xl">Agent not found</p>
        <Link to="/agents" className="btn-ghost mt-6 inline-flex">Back to registry</Link>
      </div>
      <SiteFooter />
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <div className="container-edge py-32 text-center">
        <p className="font-display text-3xl">Could not load agent</p>
        <p className="text-sm text-muted-foreground mt-2">{error.message}</p>
      </div>
      <SiteFooter />
    </div>
  ),
});

function AgentDetail() {
  const { agentId } = Route.useParams();
  const agents = useMesh((s) => s.agents);
  const attestations = useMesh((s) => s.attestations);
  const agent = agents.find((a) => a.id === agentId || a.name === agentId);
  if (!agent) throw notFound();
  const recent = attestations.filter((a) => a.agentName === agent.name).slice(0, 20);

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="aurora">
          <div className="container-edge pt-16 pb-10">
            <Link to="/agents" className="text-xs text-muted-foreground hover:text-accent">&larr; Registry</Link>
            <div className="flex items-end justify-between flex-wrap gap-6 mt-4">
              <div>
                <p className="text-xs uppercase tracking-widest text-muted-foreground">{agent.op}</p>
                <h1 className="editorial-h1 text-5xl md:text-6xl mt-2">{agent.name}</h1>
                <p className="font-mono text-xs text-muted-foreground mt-3">INFT {agent.id} · owner {agent.owner.slice(0,6)}…{agent.owner.slice(-4)}</p>
              </div>
              <div className="grid grid-cols-3 gap-px bg-border rounded-2xl overflow-hidden text-center">
                <Stat l="Reputation" v={String(agent.reputation)} />
                <Stat l="Stake" v={`${agent.stake} OG`} />
                <Stat l="Earned" v={`${agent.earned.toFixed(2)} OG`} />
              </div>
            </div>
          </div>
        </section>

        <section className="container-edge py-12 grid lg:grid-cols-3 gap-6">
          <div className="card-soft p-6">
            <h2 className="font-display text-xl">Capabilities</h2>
            <div className="flex flex-wrap gap-2 mt-4">
              {agent.capabilities.map((c) => (
                <span key={c} className="text-xs font-mono px-2.5 py-1 rounded-full border border-border/60">{c}</span>
              ))}
            </div>
            <h2 className="font-display text-xl mt-8">Lifetime</h2>
            <dl className="grid grid-cols-2 gap-4 mt-4 text-sm">
              <div><dt className="text-muted-foreground text-xs">Jobs completed</dt><dd className="font-mono mt-1">{agent.jobs}</dd></div>
              <div><dt className="text-muted-foreground text-xs">Registered</dt><dd className="font-mono mt-1">{new Date(agent.registeredAt).toLocaleDateString()}</dd></div>
            </dl>
          </div>

          <div className="lg:col-span-2 card-soft p-6">
            <h2 className="font-display text-xl">Recent TEE attestations</h2>
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-6">No attestations yet. This agent has not been picked up by a Task DAG bid.</p>
            ) : (
              <ul className="mt-4 divide-y divide-border/60">
                {recent.map((a) => (
                  <li key={a.id} className="py-3 flex items-center justify-between text-sm">
                    <div className="min-w-0">
                      <Link to="/explorer/$dagId" params={{ dagId: a.dagId }} className="font-mono text-xs hover:text-accent">{a.dagId}/{a.nodeId}</Link>
                      <p className="text-xs text-muted-foreground mt-0.5">{new Date(a.timestamp).toLocaleTimeString()} · {a.teeImage}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-display text-xl text-signal">{a.score}</p>
                      <p className="font-mono text-xs text-muted-foreground">+{a.payout.toFixed(3)} OG</p>
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

function Stat({ l, v }: { l: string; v: string }) {
  return (
    <div className="bg-background px-6 py-4">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{l}</p>
      <p className="font-display text-2xl mt-1">{v}</p>
    </div>
  );
}
