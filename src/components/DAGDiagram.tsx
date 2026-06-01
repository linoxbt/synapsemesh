import { Link } from "@tanstack/react-router";
import { DAGGraph } from "./DAGGraph";
import { useDAGDetails, useLiveDAGs } from "@/lib/onchain";
import type { NodeStatus, NodeType, TaskNode } from "@/lib/sdk";

const SAMPLE: { nodes: TaskNode[]; edges: [string, string][] } = {
  nodes: [
    {
      id: "a",
      label: "Research",
      type: "SEQUENTIAL" as const,
      budget: 2,
      deps: [],
      status: "Settled" as const,
      agentName: "claude-r1",
    },
    {
      id: "b1",
      label: "Draft A",
      type: "PARALLEL" as const,
      budget: 1.5,
      deps: ["a"],
      status: "Executing" as const,
      agentName: "gpt-w2",
    },
    {
      id: "b2",
      label: "Draft B",
      type: "PARALLEL" as const,
      budget: 1.5,
      deps: ["a"],
      status: "Executing" as const,
      agentName: "llama-w7",
    },
    {
      id: "c",
      label: "Merge",
      type: "REDUCE" as const,
      budget: 1,
      deps: ["b1", "b2"],
      status: "Bidding" as const,
    },
    {
      id: "d",
      label: "Verify",
      type: "SEQUENTIAL" as const,
      budget: 0.5,
      deps: ["c"],
      status: "Pending" as const,
    },
  ],
  edges: [
    ["a", "b1"],
    ["a", "b2"],
    ["b1", "c"],
    ["b2", "c"],
    ["c", "d"],
  ] as [string, string][],
};

export function DAGDiagram() {
  const { data: dags = [] } = useLiveDAGs();
  const live = dags[0];
  const { data: details } = useDAGDetails(live?.id || "");

  if (live) {
    const graphNodes = (details?.nodes || []).map((n) => ({
      ...n,
      type: n.type as NodeType,
      status: n.status as NodeStatus,
    }));

    return (
      <div className="card-soft p-4 md:p-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Live Task DAG</p>
            <p className="font-mono text-xs text-muted-foreground/70 mt-1">{live.id}</p>
          </div>
          <span className="chip">
            <span className="dot pulse-dot" /> {live.complete ? "Complete" : "Live"}
          </span>
        </div>
        {graphNodes.length > 0 ? (
          <DAGGraph nodes={graphNodes} edges={details?.edges || []} height={280} />
        ) : (
          <div className="h-[280px] grid place-items-center text-sm text-muted-foreground">
            Syncing DAG nodes from chain...
          </div>
        )}
        <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
          <Stat l="Nodes" v={String(live.nodeCount)} />
          <Stat l="Locked" v={`${Number(live.totalBudget).toFixed(2)} OG`} />
          <Stat
            l="Released"
            v={live.complete ? `${Number(live.totalBudget).toFixed(2)} OG` : "0.00 OG"}
          />
        </div>
        <Link
          to="/explorer/$dagId"
          params={{ dagId: live.id }}
          className="text-xs text-muted-foreground hover:text-accent mt-3 inline-block"
        >
          Inspect in Explorer -&gt;
        </Link>
      </div>
    );
  }

  return (
    <div className="card-soft p-4 md:p-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Sample Task DAG</p>
          <p className="font-mono text-xs text-muted-foreground/70 mt-1">
            submit one to see live data
          </p>
        </div>
        <span className="chip">Preview</span>
      </div>
      <DAGGraph nodes={SAMPLE.nodes} edges={SAMPLE.edges} height={280} />
      <Link
        to="/dashboard"
        className="text-xs text-muted-foreground hover:text-accent mt-3 inline-block"
      >
        Submit your first DAG -&gt;
      </Link>
    </div>
  );
}

function Stat({ l, v }: { l: string; v: string }) {
  return (
    <div className="rounded-lg border border-border/60 p-3">
      <p className="text-muted-foreground">{l}</p>
      <p className="font-mono text-sm mt-1">{v}</p>
    </div>
  );
}
