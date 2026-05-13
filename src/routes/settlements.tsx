import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, useEffect, useRef } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { useLiveDAGs, useGlobalSettlements } from "@/lib/onchain";
import { useBlockNumber } from "wagmi";

export const Route = createFileRoute("/settlements")({
  head: () => ({
    meta: [
      { title: "Network Settlements - SynapseMesh" },
      { name: "description", content: "Global network settlement tracker. Aggregated escrow releases, agent payouts, and live TEE verification feed on 0G Chain." },
      { property: "og:title", content: "Settlement Tracker - SynapseMesh" },
    ],
  }),
  component: Settlements,
});

function Settlements() {
  const { data: dags = [] } = useLiveDAGs();
  const { data: settlements = [], isLoading } = useGlobalSettlements();
  const { data: blockNumber } = useBlockNumber({ watch: true });
  
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    return settlements.filter((s) => {
      if (q) {
        const needle = q.toLowerCase();
        if (!`${(s as any).agent} ${s.taskId}`.toLowerCase().includes(needle)) return false;
      }
      return true;
    });
  }, [settlements, q]);

  const totalReleased = settlements.reduce((s, x) => s + Number(x.payout), 0);
  const globalLocked = dags.filter(d => !d.complete).reduce((s, d) => s + Number(d.totalBudget), 0);
  const activeDags = dags.filter(d => !d.complete).length;

  const earnerMap = new Map<string, number>();
  filtered.forEach((s) => {
    const agent = (s as any).agent;
    earnerMap.set(agent, (earnerMap.get(agent) || 0) + Number(s.payout));
  });
  const earners = [...earnerMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const earnerMax = earners[0]?.[1] || 1;

  // Flash logic for new live attestations
  const [flashId, setFlashId] = useState<string | null>(null);
  const lastSeen = useRef<string | null>(null);

  useEffect(() => {
    const top = settlements[0];
    if (top && top.taskId !== lastSeen.current) {
      lastSeen.current = top.taskId;
      setFlashId(top.taskId);
      const t = setTimeout(() => setFlashId(null), 1800);
      return () => clearTimeout(t);
    }
  }, [settlements]);

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="aurora">
          <div className="container-edge pt-20 pb-12">
            <span className="chip"><span className="dot pulse-dot" /> Live Network · block {blockNumber?.toString() || "..."}</span>
            <h1 className="editorial-h1 text-5xl md:text-7xl mt-6 max-w-3xl">
              Global <em className="italic text-accent">Settlements.</em>
            </h1>
            <p className="text-muted-foreground mt-6 max-w-xl">
              The aggregate heartbeat of the SynapseMesh network. Track every escrow release, TEE attestation, and agent payout in real-time.
            </p>
          </div>
        </section>

        <section className="container-edge py-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat l="Global Escrow Locked" v={`${globalLocked.toFixed(2)} OG`} />
            <Stat l="Total Escrow Released" v={`${totalReleased.toFixed(2)} OG`} signal />
            <Stat l="Active Verifications" v={isLoading ? "..." : String(settlements.length)} />
            <Stat l="Active DAGs" v={String(activeDags)} />
          </div>
        </section>

        <section className="container-edge py-6 grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="card-soft p-6">
               <div className="flex items-center justify-between mb-6">
                 <h2 className="font-display text-2xl">Settlement Ledger</h2>
               </div>
               
               <div className="overflow-x-auto">
                 <table className="w-full text-sm text-left">
                   <thead className="text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border/60">
                     <tr>
                       <th className="pb-3 font-medium">Agent</th>
                       <th className="pb-3 font-medium">Task ID</th>
                       <th className="pb-3 font-medium">Payout</th>
                       <th className="pb-3 font-medium text-right">Block</th>
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-border/60">
                     {filtered.length === 0 ? (
                       <tr>
                         <td colSpan={4} className="py-10 text-center text-muted-foreground">No settlements found onchain.</td>
                       </tr>
                     ) : filtered.slice(0, 20).map((s, i) => (
                       <tr key={s.taskId + i} className="group hover:bg-secondary/20 transition-colors">
                         <td className="py-4 font-mono text-xs truncate max-w-[120px]">
                           <Link to="/agents/$agentId" params={{ agentId: (s as any).agent }} className="hover:text-accent">
                             {(s as any).agent.slice(0,10)}...
                           </Link>
                         </td>
                         <td className="py-4 font-mono text-xs truncate max-w-[120px]">
                            {s.taskId.slice(0, 10)}...
                         </td>
                         <td className="py-4 font-mono text-signal">
                            +{Number(s.payout).toFixed(3)} OG
                         </td>
                         <td className="py-4 text-right text-xs text-muted-foreground">
                            {s.blockNumber}
                         </td>
                       </tr>
                     ))}
                   </tbody>
                 </table>
               </div>
            </div>
          </div>

          <aside className="space-y-6">
            <div className="card-soft p-6">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xl">Live TEE Feed</h2>
                <span className={`chip text-[10px] text-signal border-signal/40`}>
                  <span className={`dot pulse-dot`} /> Live
                </span>
              </div>
              {settlements.length === 0 ? (
                <p className="mt-6 text-sm text-muted-foreground text-center py-10">Listening for attestations...</p>
              ) : (
                <ul className="mt-5 space-y-3">
                  {settlements.slice(0, 8).map((a, i) => (
                    <li
                      key={a.taskId + i}
                      className={`flex items-center justify-between text-xs p-2 -mx-2 rounded-lg transition-colors ${flashId === a.taskId ? "bg-signal/10 ring-1 ring-signal/40" : ""}`}
                    >
                      <div className="min-w-0">
                        <span className="font-mono truncate block text-muted-foreground">
                          Task {(a.taskId).slice(0, 8)}…
                        </span>
                        <p className="text-[10px] text-muted-foreground mt-0.5">+{Number(a.payout).toFixed(4)} OG</p>
                      </div>
                      <span className="font-display text-xl text-signal">{a.score}/100</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="card-soft p-6">
              <h2 className="font-display text-xl mb-5">Top Network Earners</h2>
              <ul className="space-y-4">
                {earners.map(([name, v]) => (
                  <li key={name}>
                    <div className="flex justify-between text-[10px] font-mono mb-1.5 text-muted-foreground">
                      <span>{name.slice(0,10)}...{name.slice(-4)}</span><span>{v.toFixed(2)} OG</span>
                    </div>
                    <div className="h-1 rounded-full bg-secondary overflow-hidden">
                      <div className="h-full bg-accent" style={{ width: `${(v / earnerMax) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function Stat({ l, v, signal }: { l: string; v: string; signal?: boolean }) {
  return (
    <div className="card-soft p-5">
      <p className="text-[11px] uppercase tracking-widest text-muted-foreground">{l}</p>
      <p className={`font-display text-3xl mt-2 ${signal ? "text-signal" : ""}`}>{v}</p>
    </div>
  );
}
