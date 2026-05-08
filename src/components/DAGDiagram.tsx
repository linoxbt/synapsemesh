export function DAGDiagram() {
  // Stylized DAG with animated flow lines
  const nodes = [
    { id: "A", x: 60, y: 110, label: "Research", agent: "claude-r1" },
    { id: "B1", x: 230, y: 50, label: "Draft §1", agent: "gpt-w2" },
    { id: "B2", x: 230, y: 110, label: "Draft §2", agent: "gpt-w2" },
    { id: "B3", x: 230, y: 170, label: "Draft §3", agent: "llama-w7" },
    { id: "C", x: 410, y: 110, label: "Reduce", agent: "merge-bot" },
    { id: "D", x: 580, y: 110, label: "TEE Verify", agent: "0g-tee" },
  ];
  const edges: [string, string][] = [
    ["A", "B1"], ["A", "B2"], ["A", "B3"],
    ["B1", "C"], ["B2", "C"], ["B3", "C"],
    ["C", "D"],
  ];
  const find = (id: string) => nodes.find((n) => n.id === id)!;

  return (
    <div className="relative card-soft p-6 overflow-hidden">
      <div className="absolute inset-0 grid-lines opacity-40 pointer-events-none" />
      <div className="flex items-center justify-between mb-4 relative">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Live Task DAG</p>
          <p className="font-mono text-xs text-muted-foreground/70 mt-1">0xa1b2…f93e</p>
        </div>
        <span className="chip"><span className="dot pulse-dot" /> Executing</span>
      </div>
      <svg viewBox="0 0 660 240" className="w-full h-auto relative">
        <defs>
          <linearGradient id="edge" x1="0" x2="1">
            <stop offset="0" stopColor="oklch(0.78 0.16 65)" stopOpacity="0.2" />
            <stop offset="1" stopColor="oklch(0.78 0.16 65)" stopOpacity="0.9" />
          </linearGradient>
        </defs>
        {edges.map(([from, to], i) => {
          const a = find(from); const b = find(to);
          return (
            <path
              key={i}
              d={`M${a.x + 50},${a.y} C${(a.x + b.x) / 2 + 30},${a.y} ${(a.x + b.x) / 2 - 30},${b.y} ${b.x},${b.y}`}
              stroke="url(#edge)"
              strokeWidth="1.5"
              fill="none"
              className="flow-line"
            />
          );
        })}
        {nodes.map((n) => (
          <g key={n.id} transform={`translate(${n.x},${n.y - 22})`}>
            <rect width="100" height="44" rx="10" fill="oklch(0.22 0.016 250)" stroke="oklch(0.32 0.018 250)" />
            <circle cx="12" cy="22" r="3" fill="oklch(0.82 0.18 145)" />
            <text x="22" y="20" fill="oklch(0.97 0.005 80)" fontSize="11" fontFamily="Inter">{n.label}</text>
            <text x="22" y="34" fill="oklch(0.68 0.015 250)" fontSize="9" fontFamily="JetBrains Mono">{n.agent}</text>
          </g>
        ))}
      </svg>
      <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
        {[
          { l: "Nodes", v: "6" },
          { l: "Locked", v: "12.4 OG" },
          { l: "ETA", v: "~38s" },
        ].map((s) => (
          <div key={s.l} className="rounded-lg border border-border/60 p-3">
            <p className="text-muted-foreground">{s.l}</p>
            <p className="font-mono text-sm mt-1">{s.v}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
