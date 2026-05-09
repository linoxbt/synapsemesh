import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { useMesh, type Settlement, type Attestation } from "@/lib/sdk";

export const Route = createFileRoute("/settlements")({
  head: () => ({
    meta: [
      { title: "Settlement Tracker - SynapseMesh" },
      { name: "description", content: "Aggregated escrow releases and agent payouts as each Task DAG node is verified by the TEE verifier on 0G Chain." },
      { property: "og:title", content: "Settlement Tracker - SynapseMesh" },
    ],
  }),
  component: Settlements,
});

type Kind = "all" | "release" | "slash";

function Settlements() {
  const settlements = useMesh((s) => s.settlements);
  const dags = useMesh((s) => s.dags);
  const attestations = useMesh((s) => s.attestations);

  const [dagId, setDagId] = useState<string>("all");
  const [nodeId, setNodeId] = useState<string>("all");
  const [verifier, setVerifier] = useState<string>("all");
  const [kind, setKind] = useState<Kind>("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Settlement | null>(null);

  const verifiers = useMemo(() => {
    const set = new Set<string>();
    attestations.forEach((a) => set.add(a.teeImage));
    return [...set];
  }, [attestations]);

  const nodeOptions = useMemo(() => {
    if (dagId === "all") return [];
    const d = dags.find((x) => x.id === dagId);
    return d?.nodes ?? [];
  }, [dagId, dags]);

  const attByNode = useMemo(() => {
    const m = new Map<string, Attestation>();
    attestations.forEach((a) => m.set(`${a.dagId}/${a.nodeId}`, a));
    return m;
  }, [attestations]);

  const filtered = useMemo(() => {
    return settlements.filter((s) => {
      if (dagId !== "all" && s.dagId !== dagId) return false;
      if (nodeId !== "all" && s.nodeId !== nodeId) return false;
      if (kind !== "all" && s.kind !== kind) return false;
      if (verifier !== "all") {
        const att = attByNode.get(`${s.dagId}/${s.nodeId}`);
        if (att?.teeImage !== verifier) return false;
      }
      if (q) {
        const needle = q.toLowerCase();
        if (!`${s.agentName} ${s.nodeLabel} ${s.dagId} ${s.nodeId}`.toLowerCase().includes(needle)) return false;
      }
      return true;
    });
  }, [settlements, dagId, nodeId, kind, verifier, q, attByNode]);

  const totalReleased = filtered.filter((s) => s.kind === "release").reduce((s, x) => s + x.amount, 0);
  const totalSlashed = filtered.filter((s) => s.kind === "slash").reduce((s, x) => s + x.amount, 0);
  const locked = dags.reduce((s, d) => s + d.locked, 0);

  const earnerMap = new Map<string, number>();
  filtered.forEach((s) => earnerMap.set(s.agentName, (earnerMap.get(s.agentName) || 0) + (s.kind === "release" ? s.amount : 0)));
  const earners = [...earnerMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const earnerMax = earners[0]?.[1] || 1;

  const exportCsv = () => {
    const rows = [
      ["timestamp", "kind", "amount_OG", "agent", "dag_id", "node_id", "node_label", "verifier", "tee_score"],
      ...filtered.map((s) => {
        const att = attByNode.get(`${s.dagId}/${s.nodeId}`);
        return [
          new Date(s.timestamp).toISOString(),
          s.kind,
          s.amount.toFixed(6),
          s.agentName,
          s.dagId,
          s.nodeId,
          s.nodeLabel,
          att?.teeImage ?? "",
          att?.score?.toString() ?? "",
        ];
      }),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `synapsemesh-settlements-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="aurora">
          <div className="container-edge pt-20 pb-12">
            <span className="chip">Settlement Tracker</span>
            <h1 className="editorial-h1 text-5xl md:text-7xl mt-6 max-w-3xl">
              The DAG pays itself <em className="italic text-accent">as it executes.</em>
            </h1>
            <p className="text-muted-foreground mt-6 max-w-xl">
              Every TEE attestation triggers MeshEscrow.sol to release a per-node payout. Slashes flow through the same lane in reverse.
            </p>
          </div>
        </section>

        <section className="container-edge py-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat l="Locked in escrow" v={`${locked.toFixed(2)} OG`} />
            <Stat l="Released (filtered)" v={`${totalReleased.toFixed(2)} OG`} signal />
            <Stat l="Slashed (filtered)" v={`${totalSlashed.toFixed(2)} OG`} />
            <Stat l="Settlements (filtered)" v={String(filtered.length)} />
          </div>
        </section>

        <section className="container-edge">
          <div className="card-soft p-4 grid grid-cols-1 md:grid-cols-12 gap-3">
            <input
              placeholder="Search agent, node, dag..."
              value={q} onChange={(e) => setQ(e.target.value)}
              className="md:col-span-3 bg-secondary/40 border border-border rounded-lg px-3 py-2 text-sm"
            />
            <select value={dagId} onChange={(e) => { setDagId(e.target.value); setNodeId("all"); }}
              className="md:col-span-3 bg-secondary/40 border border-border rounded-lg px-3 py-2 text-sm font-mono">
              <option value="all">All DAGs</option>
              {dags.map((d) => <option key={d.id} value={d.id}>{d.title} · {d.id}</option>)}
            </select>
            <select value={nodeId} onChange={(e) => setNodeId(e.target.value)}
              disabled={dagId === "all"}
              className="md:col-span-2 bg-secondary/40 border border-border rounded-lg px-3 py-2 text-sm font-mono disabled:opacity-40">
              <option value="all">All nodes</option>
              {nodeOptions.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
            </select>
            <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}
              className="md:col-span-2 bg-secondary/40 border border-border rounded-lg px-3 py-2 text-sm">
              <option value="all">All status</option>
              <option value="release">Released</option>
              <option value="slash">Slashed</option>
            </select>
            <select value={verifier} onChange={(e) => setVerifier(e.target.value)}
              className="md:col-span-2 bg-secondary/40 border border-border rounded-lg px-3 py-2 text-sm font-mono">
              <option value="all">Any verifier</option>
              {verifiers.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="flex justify-end mt-3">
            <button onClick={exportCsv} disabled={filtered.length === 0}
              className="btn-ghost !py-1.5 !px-3 text-xs disabled:opacity-40">
              Export {filtered.length} rows as CSV
            </button>
          </div>
        </section>

        <section className="container-edge py-6 grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 card-soft p-6">
            <h2 className="font-display text-2xl">Settlements</h2>
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-6">
                {settlements.length === 0
                  ? "No settlements yet. Each TEE attestation will appear here as MeshEscrow releases its node payout."
                  : "No settlements match the current filters."}
              </p>
            ) : (
              <ul className="mt-5 divide-y divide-border/60">
                {filtered.slice(0, 60).map((s) => {
                  const active = selected?.id === s.id;
                  return (
                    <li key={s.id}>
                      <button
                        onClick={() => setSelected(active ? null : s)}
                        className={`w-full text-left py-3 flex items-center gap-3 text-sm rounded-lg px-2 -mx-2 ${active ? "bg-secondary/40" : "hover:bg-secondary/30"}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${s.kind === "release" ? "bg-signal" : "bg-destructive"}`} />
                        <div className="flex-1 min-w-0">
                          <p className="truncate">
                            <span className="font-mono">{s.agentName}</span>
                            <span className="text-muted-foreground"> · {s.nodeLabel}</span>
                          </p>
                          <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">
                            {s.dagId}/{s.nodeId} · {new Date(s.timestamp).toLocaleTimeString()}
                          </p>
                        </div>
                        <span className={`font-mono ${s.kind === "release" ? "text-signal" : "text-destructive"}`}>
                          {s.kind === "release" ? "+" : "-"}{s.amount.toFixed(3)} OG
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="card-soft p-6 h-fit">
            {selected ? (
              <NodeTimeline s={selected} att={attByNode.get(`${selected.dagId}/${selected.nodeId}`)} />
            ) : (
              <>
                <h2 className="font-display text-2xl">Top earners</h2>
                {earners.length === 0 ? (
                  <p className="text-sm text-muted-foreground mt-6">No earnings match.</p>
                ) : (
                  <ul className="mt-5 space-y-3">
                    {earners.map(([name, v]) => (
                      <li key={name}>
                        <div className="flex justify-between text-sm font-mono">
                          <span>{name}</span><span>{v.toFixed(2)} OG</span>
                        </div>
                        <div className="h-1.5 mt-2 rounded-full bg-secondary overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-accent to-mesh" style={{ width: `${(v / earnerMax) * 100}%` }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[11px] text-muted-foreground mt-6">Select a settlement to view its per-node timeline.</p>
              </>
            )}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function NodeTimeline({ s, att }: { s: Settlement; att?: Attestation }) {
  const dag = useMesh((st) => st.dags.find((d) => d.id === s.dagId));
  const node = dag?.nodes.find((n) => n.id === s.nodeId);
  const events = [
    { label: "Submitted", at: dag?.createdAt, tone: "text-muted-foreground" },
    { label: "Bidding open", at: dag?.createdAt, tone: "text-accent" },
    { label: `Bid won by ${s.agentName}`, at: s.timestamp - 4000, tone: "text-mesh" },
    { label: "Executing", at: s.timestamp - 2000, tone: "text-primary" },
    { label: `TEE attested · score ${att?.score ?? "-"}`, at: s.timestamp - 500, tone: "text-signal" },
    { label: `${s.kind === "release" ? "Released" : "Slashed"} ${s.amount.toFixed(3)} OG`, at: s.timestamp, tone: s.kind === "release" ? "text-signal" : "text-destructive" },
  ];

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Node timeline</p>
          <h3 className="font-display text-xl mt-1 truncate">{s.nodeLabel}</h3>
          <p className="text-xs font-mono text-muted-foreground mt-1 truncate">
            <Link to="/explorer/$dagId" params={{ dagId: s.dagId }} className="hover:text-accent">{s.dagId}</Link>/{s.nodeId}
          </p>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3 text-xs">
        <Cell k="Agent" v={s.agentName} />
        <Cell k="Type" v={node?.type ?? "-"} />
        <Cell k="Budget" v={node ? `${node.budget} OG` : "-"} />
        <Cell k="Payout" v={`${s.amount.toFixed(3)} OG`} />
        <Cell k="TEE score" v={att?.score?.toString() ?? "-"} />
        <Cell k="Verifier" v={att?.teeImage ?? "-"} />
      </dl>

      <div className="hairline my-5" />
      <ol className="space-y-3">
        {events.map((e, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className={`mt-1.5 w-1.5 h-1.5 rounded-full ${e.tone.replace("text-", "bg-")}`} />
            <div className="flex-1 min-w-0">
              <p className={`text-sm ${e.tone}`}>{e.label}</p>
              <p className="text-[11px] text-muted-foreground font-mono">
                {e.at ? new Date(e.at).toLocaleTimeString() : "-"}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{k}</p>
      <p className="font-mono mt-0.5 truncate">{v}</p>
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
