// Local @synapsemesh/sdk shim. Mirrors the on-chain contract surface so the UI
// is fully wired and ready to swap to deployed 0G Chain contracts later.
// State is held in-memory + persisted to localStorage so the user can submit
// DAGs / register agents / observe TEE attestations end-to-end from the UI.

import { useEffect, useState } from "react";

export type AgentOp = "Researcher" | "Writer" | "Verifier" | "Vision" | "Aggregator" | "Coder" | "Custom";
export type NodeType = "SEQUENTIAL" | "PARALLEL" | "CONDITIONAL" | "REDUCE";
export type NodeStatus = "Pending" | "Bidding" | "Executing" | "AwaitingVerify" | "Settled" | "Failed";
export type DagStatus = "Bidding" | "Executing" | "AwaitingVerify" | "Settled" | "Failed";

export interface Agent {
  id: string;          // INFT token id (synthetic)
  name: string;
  op: AgentOp;
  capabilities: string[];
  stake: number;       // OG
  reputation: number;  // 0-100
  jobs: number;
  earned: number;      // OG
  owner: string;       // wallet address
  registeredAt: number;
}

export interface TaskNode {
  id: string;
  label: string;
  type: NodeType;
  budget: number;      // OG
  deps: string[];
  agentId?: string;
  agentName?: string;
  status: NodeStatus;
  score?: number;      // TEE score 0-100
  payout?: number;     // OG released on settlement
  attestation?: Attestation;
}

export interface TaskDAG {
  id: string;          // tx hash style
  title: string;
  owner: string;
  nodes: TaskNode[];
  edges: [string, string][];
  totalBudget: number;
  locked: number;
  released: number;
  status: DagStatus;
  block: number;
  createdAt: number;
}

export interface Attestation {
  id: string;
  dagId: string;
  nodeId: string;
  agentName: string;
  score: number;
  payout: number;
  teeImage: string;
  timestamp: number;
}

export interface Settlement {
  id: string;
  dagId: string;
  nodeId: string;
  nodeLabel: string;
  agentName: string;
  amount: number;
  kind: "release" | "slash";
  timestamp: number;
}

interface State {
  agents: Agent[];
  dags: TaskDAG[];
  attestations: Attestation[];
  settlements: Settlement[];
  block: number;
}

const STORAGE_KEY = "synapsemesh.state.v1";

function loadState(): State {
  if (typeof window === "undefined") return { agents: [], dags: [], attestations: [], settlements: [], block: 12_847_221 };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { agents: [], dags: [], attestations: [], settlements: [], block: 12_847_221 };
}

let state: State = loadState();
const listeners = new Set<() => void>();

function persist() {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  listeners.forEach((l) => l());
}

function rand(min: number, max: number) { return Math.random() * (max - min) + min; }
function hex(len = 8) {
  const chars = "0123456789abcdef";
  let s = "0x";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * 16)];
  return s;
}
function shortHash() { return `${hex(4)}…${hex(4).slice(2)}`; }

// Background block ticker
if (typeof window !== "undefined") {
  setInterval(() => {
    state.block += 1;
    listeners.forEach((l) => l());
  }, 2500);
}

export const mesh = {
  getState: () => state,

  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  reset() {
    state = { agents: [], dags: [], attestations: [], settlements: [], block: state.block };
    persist();
  },

  agents: {
    list: () => state.agents,
    get: (id: string) => state.agents.find((a) => a.id === id || a.name === id),
    register(input: { name: string; op: AgentOp; stake: number; capabilities: string[]; owner: string }) {
      const agent: Agent = {
        id: hex(8),
        name: input.name,
        op: input.op,
        capabilities: input.capabilities,
        stake: input.stake,
        reputation: 80,
        jobs: 0,
        earned: 0,
        owner: input.owner,
        registeredAt: Date.now(),
      };
      state.agents.push(agent);
      persist();
      return agent;
    },
  },

  dags: {
    list: () => state.dags,
    get: (id: string) => state.dags.find((d) => d.id === id),
    submit(input: { title: string; owner: string; nodes: Array<{ label: string; type: NodeType; budget: number; deps?: string[] }> }) {
      const ids = input.nodes.map(() => hex(3));
      const nodes: TaskNode[] = input.nodes.map((n, i) => ({
        id: ids[i],
        label: n.label,
        type: n.type,
        budget: n.budget,
        deps: (n.deps || []).map((d) => {
          const idx = input.nodes.findIndex((x) => x.label === d);
          return idx >= 0 ? ids[idx] : d;
        }),
        status: "Bidding",
      }));
      const edges: [string, string][] = [];
      nodes.forEach((n) => n.deps.forEach((d) => edges.push([d, n.id])));
      const totalBudget = nodes.reduce((s, n) => s + n.budget, 0);
      const dag: TaskDAG = {
        id: hex(8),
        title: input.title,
        owner: input.owner,
        nodes,
        edges,
        totalBudget,
        locked: totalBudget,
        released: 0,
        status: "Bidding",
        block: state.block,
        createdAt: Date.now(),
      };
      state.dags.unshift(dag);
      persist();
      simulateExecution(dag.id);
      return dag;
    },
  },

  attestations: { list: () => state.attestations },
  settlements: { list: () => state.settlements },
};

function simulateExecution(dagId: string) {
  const dag = state.dags.find((d) => d.id === dagId);
  if (!dag) return;

  dag.nodes.forEach((node, i) => {
    // pick an agent (any registered one matching, else synthetic name)
    const candidates = state.agents.length ? state.agents : [];
    const agent = candidates[i % Math.max(candidates.length, 1)];

    // bid -> executing
    setTimeout(() => {
      const cur = state.dags.find((d) => d.id === dagId);
      if (!cur) return;
      const n = cur.nodes.find((x) => x.id === node.id)!;
      n.agentId = agent?.id;
      n.agentName = agent?.name || `agent-${node.id.slice(2)}`;
      n.status = "Executing";
      cur.status = "Executing";
      persist();
    }, 1500 + i * 800);

    // executing -> awaiting verify -> settled
    setTimeout(() => {
      const cur = state.dags.find((d) => d.id === dagId);
      if (!cur) return;
      const n = cur.nodes.find((x) => x.id === node.id)!;
      n.status = "AwaitingVerify";
      persist();
    }, 3500 + i * 1200);

    setTimeout(() => {
      const cur = state.dags.find((d) => d.id === dagId);
      if (!cur) return;
      const n = cur.nodes.find((x) => x.id === node.id)!;
      const score = Math.round(rand(85, 99));
      const payout = +(n.budget * (score / 100)).toFixed(4);
      const att: Attestation = {
        id: hex(6),
        dagId: cur.id,
        nodeId: n.id,
        agentName: n.agentName || "agent",
        score,
        payout,
        teeImage: "0g-tee/judge:v1.4",
        timestamp: Date.now(),
      };
      n.score = score;
      n.payout = payout;
      n.attestation = att;
      n.status = "Settled";
      cur.locked = +(cur.locked - n.budget).toFixed(4);
      cur.released = +(cur.released + payout).toFixed(4);
      state.attestations.unshift(att);
      state.settlements.unshift({
        id: hex(6),
        dagId: cur.id,
        nodeId: n.id,
        nodeLabel: n.label,
        agentName: n.agentName || "agent",
        amount: payout,
        kind: "release",
        timestamp: Date.now(),
      });
      // bump agent stats
      if (n.agentId) {
        const ag = state.agents.find((a) => a.id === n.agentId);
        if (ag) {
          ag.jobs += 1;
          ag.earned = +(ag.earned + payout).toFixed(4);
          ag.reputation = Math.min(100, Math.round(ag.reputation * 0.9 + score * 0.1));
        }
      }
      if (cur.nodes.every((x) => x.status === "Settled")) cur.status = "Settled";
      persist();
    }, 5500 + i * 1600);
  });
}

// React hook
export function useMesh<T>(selector: (s: State) => T): T {
  const [val, setVal] = useState<T>(() => selector(state));
  useEffect(() => {
    const update = () => setVal(selector(state));
    update();
    const unsub = mesh.subscribe(update);
    return () => { unsub(); };
  }, [selector]);
  return val;
}

export { shortHash, hex };
