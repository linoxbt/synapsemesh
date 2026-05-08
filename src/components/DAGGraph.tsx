import type { TaskNode } from "@/lib/sdk";

interface Props {
  nodes: TaskNode[];
  edges: [string, string][];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  height?: number;
}

const STATUS_COLOR: Record<TaskNode["status"], string> = {
  Pending: "oklch(0.55 0.02 250)",
  Bidding: "oklch(0.78 0.16 65)",
  Executing: "oklch(0.68 0.19 285)",
  AwaitingVerify: "oklch(0.92 0.08 95)",
  Settled: "oklch(0.82 0.18 145)",
  Failed: "oklch(0.62 0.22 25)",
};

// Simple layered layout based on dependency depth
function layout(nodes: TaskNode[]) {
  const depth = new Map<string, number>();
  const visit = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    const n = nodes.find((x) => x.id === id)!;
    if (!n) return 0;
    const d = n.deps.length === 0 ? 0 : 1 + Math.max(...n.deps.map(visit));
    depth.set(id, d);
    return d;
  };
  nodes.forEach((n) => visit(n.id));
  const cols: Record<number, string[]> = {};
  nodes.forEach((n) => {
    const d = depth.get(n.id) ?? 0;
    cols[d] = cols[d] || [];
    cols[d].push(n.id);
  });
  const colCount = Object.keys(cols).length;
  const positions: Record<string, { x: number; y: number }> = {};
  Object.entries(cols).forEach(([d, ids]) => {
    const col = Number(d);
    ids.forEach((id, i) => {
      const x = 80 + (col / Math.max(colCount - 1, 1)) * 580;
      const y = 60 + (i + 0.5) * (320 / Math.max(ids.length, 1));
      positions[id] = { x, y };
    });
  });
  return positions;
}

export function DAGGraph({ nodes, edges, selectedId, onSelect, height = 380 }: Props) {
  if (!nodes.length) {
    return (
      <div className="card-soft p-10 text-center text-sm text-muted-foreground" style={{ minHeight: height }}>
        No nodes to render.
      </div>
    );
  }
  const pos = layout(nodes);
  const W = 740;
  const H = height;

  return (
    <div className="card-soft p-4 overflow-hidden">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" style={{ maxHeight: H }}>
        <defs>
          <linearGradient id="g-edge" x1="0" x2="1">
            <stop offset="0" stopColor="oklch(0.78 0.16 65)" stopOpacity="0.15" />
            <stop offset="1" stopColor="oklch(0.78 0.16 65)" stopOpacity="0.85" />
          </linearGradient>
        </defs>
        {edges.map(([from, to], i) => {
          const a = pos[from]; const b = pos[to];
          if (!a || !b) return null;
          return (
            <path
              key={i}
              d={`M${a.x + 50},${a.y} C${(a.x + b.x) / 2 + 30},${a.y} ${(a.x + b.x) / 2 - 30},${b.y} ${b.x - 50},${b.y}`}
              stroke="url(#g-edge)"
              strokeWidth="1.5"
              fill="none"
              className="flow-line"
            />
          );
        })}
        {nodes.map((n) => {
          const p = pos[n.id];
          const sel = selectedId === n.id;
          const color = STATUS_COLOR[n.status];
          return (
            <g
              key={n.id}
              transform={`translate(${p.x - 50},${p.y - 22})`}
              onClick={() => onSelect?.(n.id)}
              style={{ cursor: onSelect ? "pointer" : "default" }}
            >
              <rect
                width="100" height="44" rx="10"
                fill="oklch(0.22 0.016 250)"
                stroke={sel ? color : "oklch(0.32 0.018 250)"}
                strokeWidth={sel ? 2 : 1}
              />
              <circle cx="12" cy="22" r="3.5" fill={color}>
                {n.status === "Executing" || n.status === "AwaitingVerify" ? (
                  <animate attributeName="opacity" values="1;0.3;1" dur="1.4s" repeatCount="indefinite" />
                ) : null}
              </circle>
              <text x="22" y="20" fill="oklch(0.97 0.005 80)" fontSize="11" fontFamily="Inter">{n.label.slice(0, 14)}</text>
              <text x="22" y="34" fill="oklch(0.68 0.015 250)" fontSize="9" fontFamily="JetBrains Mono">
                {n.agentName ? n.agentName.slice(0, 14) : n.type.toLowerCase()}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-3 mt-3 text-[10px] uppercase tracking-widest text-muted-foreground">
        {(["Bidding", "Executing", "AwaitingVerify", "Settled", "Failed"] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLOR[s] }} />
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}
