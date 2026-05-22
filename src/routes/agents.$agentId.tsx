import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { UnstakeAgentButton } from "@/components/UnstakeAgentButton";
import { useLiveAgents, useAgentAttestations } from "@/lib/onchain";

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
  
  const { data: agents = [], isLoading: isLoadingAgents } = useLiveAgents();
  const agent = agents.find((a) => a.id.toLowerCase() === agentId.toLowerCase() || a.name === agentId);
  
  const { data: recent = [], isLoading: isLoadingAttest } = useAgentAttestations(agent?.id || "");

  if (!agent && !isLoadingAgents && agents.length > 0) throw notFound();
  const registryStatus = !agent ? "..." : agent.active ? "Active" : "Offline";
  const registryTone = !agent ? "text-muted-foreground" : agent.active ? "text-signal" : "text-destructive";

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="aurora">
          <div className="container-edge pt-16 pb-10">
            <Link to="/agents" className="text-xs text-muted-foreground hover:text-accent">&larr; Registry</Link>
            <div className="flex items-end justify-between flex-wrap gap-6 mt-4">
              <div>
                <p className="text-xs uppercase tracking-widest text-muted-foreground">{agent?.op || "..."}</p>
                <h1 className="editorial-h1 text-5xl md:text-6xl mt-2">{agent?.name || "Loading..."}</h1>
                <p className="font-mono text-[10px] text-muted-foreground mt-3">INFT {agent?.id} · owner {agent?.owner.slice(0,6)}…{agent?.owner.slice(-4)}</p>
              </div>
              <div className="grid grid-cols-3 gap-px bg-border rounded-2xl overflow-hidden text-center">
                <Stat l="Reputation" v={String(agent?.reputation || 0)} />
                <Stat l="Stake" v={`${Number(agent?.stake || 0).toFixed(2)} OG`} />
                <Stat l="Earned" v={`${Number(agent?.earned || 0).toFixed(2)} OG`} />
              </div>
            </div>
          </div>
        </section>

        <section className="container-edge py-12 grid lg:grid-cols-3 gap-6">
          <div className="card-soft p-6 h-fit">
            <h2 className="font-display text-xl">Onchain Status</h2>
            <dl className="grid grid-cols-2 gap-4 mt-6 text-sm">
              <div><dt className="text-muted-foreground text-xs">Jobs completed</dt><dd className="font-mono mt-1 text-lg">{agent?.jobs || 0}</dd></div>
              <div><dt className="text-muted-foreground text-xs">Registry Status</dt><dd className={`font-mono mt-1 text-lg ${registryTone}`}>{registryStatus}</dd></div>
            </dl>
            <p className="text-xs text-muted-foreground mt-8 leading-relaxed">
              This agent is an ERC-7857 INFT. Its reputation and metadata are cryptographically tied to its wallet address.
            </p>
            {agent && (
              <div className="mt-6">
                <UnstakeAgentButton agent={agent} />
              </div>
            )}
          </div>

          <div className="lg:col-span-2 card-soft p-6">
            <div className="flex justify-between items-end mb-4">
               <h2 className="font-display text-xl">Recent TEE attestations</h2>
               {isLoadingAttest && <div className="animate-spin w-4 h-4 border-2 border-accent border-t-transparent rounded-full" />}
            </div>
            
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-6">No attestations yet. This agent has not been picked up by a Task DAG bid.</p>
            ) : (
              <ul className="mt-4 divide-y divide-border/60">
                {recent.map((a) => (
                  <li key={a.taskId} className="py-3 flex items-center justify-between text-sm hover:bg-secondary/30 -mx-2 px-2 rounded-lg transition-colors">
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-muted-foreground truncate max-w-[200px] md:max-w-sm">Task {a.taskId}</p>
                      <p className="text-[10px] text-muted-foreground mt-1 uppercase tracking-widest">Block {a.blockNumber}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-display text-xl text-signal">{a.score}/100</p>
                      <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">+{Number(a.payout).toFixed(2)} OG</p>
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
