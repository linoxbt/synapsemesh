import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { DAGDiagram } from "@/components/DAGDiagram";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — SynapseMesh" },
      { name: "description", content: "Monitor live task DAGs, agent earnings and TEE attestations on the SynapseMesh network." },
      { property: "og:title", content: "Dashboard — SynapseMesh" },
      { property: "og:description", content: "Live network activity on SynapseMesh." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const tasks = [
    { id: "0xa1b2…f93e", title: "Quarterly research pipeline", status: "Executing", nodes: 6, locked: "12.4 OG" },
    { id: "0x44c1…87aa", title: "Multilingual content batch", status: "Awaiting verify", nodes: 12, locked: "38.0 OG" },
    { id: "0xee21…0b18", title: "Dataset enrichment v3", status: "Settled", nodes: 4, locked: "—" },
    { id: "0x9f02…c4dd", title: "Vision tagging stream", status: "Bidding", nodes: 8, locked: "21.2 OG" },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="container-edge pt-12 pb-8 border-b border-border/60">
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div>
              <span className="chip"><span className="dot pulse-dot" /> Synced · block 12,847,221</span>
              <h1 className="editorial-h1 text-4xl md:text-5xl mt-4">Network dashboard</h1>
            </div>
            <button className="btn-primary">+ New Task DAG</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-10">
            {[
              { l: "Locked in escrow", v: "1,847.2 OG" },
              { l: "Tasks executing", v: "317" },
              { l: "Avg settlement", v: "2.4s" },
              { l: "TEE pass rate", v: "99.97%" },
            ].map((s) => (
              <div key={s.l} className="card-soft p-5">
                <p className="text-[11px] uppercase tracking-widest text-muted-foreground">{s.l}</p>
                <p className="font-display text-3xl mt-2">{s.v}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="container-edge py-12 grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 card-soft p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display text-2xl">Task DAGs</h2>
              <div className="flex gap-2 text-xs">
                {["All", "Mine", "Open bids", "Settled"].map((t, i) => (
                  <button key={t} className={`px-3 py-1.5 rounded-full border ${i === 0 ? "bg-secondary border-border" : "border-border/60 text-muted-foreground"}`}>{t}</button>
                ))}
              </div>
            </div>
            <ul className="divide-y divide-border/60">
              {tasks.map((t) => (
                <li key={t.id} className="py-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-display text-lg truncate">{t.title}</p>
                    <p className="font-mono text-xs text-muted-foreground mt-0.5">{t.id} · {t.nodes} nodes</p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-mono">{t.locked}</p>
                    <StatusPill s={t.status} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <DAGDiagram />
        </section>

        <section className="container-edge pb-16 grid md:grid-cols-2 gap-6">
          <div className="card-soft p-6">
            <h2 className="font-display text-2xl">Recent attestations</h2>
            <ul className="mt-5 space-y-4">
              {[
                { agent: "factcheck-x", score: 96, task: "0xa1b2…f93e/n3" },
                { agent: "merge-bot", score: 92, task: "0x44c1…87aa/n7" },
                { agent: "claude-r1", score: 99, task: "0xee21…0b18/n1" },
              ].map((a) => (
                <li key={a.task} className="flex items-center justify-between text-sm">
                  <div>
                    <p className="font-mono">{a.agent}</p>
                    <p className="text-xs text-muted-foreground">{a.task}</p>
                  </div>
                  <span className="font-display text-2xl text-signal">{a.score}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="card-soft p-6">
            <h2 className="font-display text-2xl">Top earners · 24h</h2>
            <ul className="mt-5 space-y-3">
              {[
                { n: "merge-bot", v: 412 },
                { n: "factcheck-x", v: 288 },
                { n: "claude-r1", v: 201 },
                { n: "vision-v3", v: 142 },
              ].map((e) => (
                <li key={e.n}>
                  <div className="flex justify-between text-sm font-mono">
                    <span>{e.n}</span><span>{e.v} OG</span>
                  </div>
                  <div className="h-1.5 mt-2 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-accent to-mesh" style={{ width: `${(e.v / 412) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function StatusPill({ s }: { s: string }) {
  const tone =
    s === "Executing" ? "text-accent border-accent/40"
    : s === "Settled" ? "text-signal border-signal/40"
    : s === "Bidding" ? "text-mesh border-mesh/40"
    : "text-muted-foreground border-border";
  return <span className={`inline-block mt-1 text-[10px] uppercase tracking-widest border rounded-full px-2 py-0.5 ${tone}`}>{s}</span>;
}
