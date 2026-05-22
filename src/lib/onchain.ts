import { useQuery } from "@tanstack/react-query";
import { usePublicClient, type UsePublicClientReturnType } from "wagmi";
import { parseAbiItem, hexToString, formatEther, type Address, type AbiEvent } from "viem";
import { CONTRACT_ADDRESSES, AGENT_REGISTRY_ABI, TASK_DAG_REGISTRY_ABI } from "./contracts";

// ─── Indexing window ──────────────────────────────────────────────────────────
// Querying eth_getLogs from block 0 on a public RPC against a 33M-block chain
// either times out or returns multi-megabyte payloads, locking up React Query
// and freezing the UI. We instead scan a bounded recent window in chunks.
const env = (import.meta as { env?: Record<string, string> }).env ?? {};
const INDEX_FROM_BLOCK = env.VITE_INDEX_FROM_BLOCK ? BigInt(env.VITE_INDEX_FROM_BLOCK) : null;
const LOOKBACK_BLOCKS = BigInt(env.VITE_INDEX_LOOKBACK_BLOCKS || "200000");
const CHUNK = BigInt(env.VITE_INDEX_CHUNK_BLOCKS || "5000");

type Client = NonNullable<UsePublicClientReturnType>;

async function getLogsWindowed(
  client: Client,
  args: { address: Address; event: AbiEvent; eventArgs?: Record<string, unknown> },
) {
  const head = await client.getBlockNumber();
  const start =
    INDEX_FROM_BLOCK !== null
      ? INDEX_FROM_BLOCK
      : head > LOOKBACK_BLOCKS
        ? head - LOOKBACK_BLOCKS
        : 0n;

  const out: Awaited<ReturnType<Client["getLogs"]>> = [];
  for (let from = start; from <= head; from += CHUNK) {
    const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n;
    try {
      const logs = await client.getLogs({
        address: args.address,
        event: args.event,
        args: args.eventArgs,
        fromBlock: from,
        toBlock: to,
      });
      out.push(...logs);
    } catch {
      // RPC chunk failed (rate limit / range cap) — skip and continue rather
      // than blow up the whole query. Next refetch will retry.
    }
  }
  return out;
}

// ─── Agents ───────────────────────────────────────────────────────────────────
export type LiveAgent = {
  id: string;
  name: string;
  op: string;
  owner: string;
  reputation: number;
  stake: string;
  jobs: number;
  earned: string;
  active: boolean;
};

const AGENT_REGISTERED = parseAbiItem(
  "event AgentRegistered(address indexed agent, bytes32 agentId, uint256 stake)",
);

function getAgentLabel(agentId: `0x${string}`, owner: string) {
  try {
    const decoded = hexToString(agentId).replace(/\0/g, "").trim();
    if (/^[\x20-\x7E]+$/.test(decoded) && decoded.length > 0) return decoded;
  } catch {
    // AgentRegistry stores keccak256(name) for current registrations, so most
    // agent IDs are opaque hashes rather than UTF-8 names.
  }
  return `Agent ${owner.slice(0, 6)}...${owner.slice(-4)}`;
}

export function useLiveAgents() {
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: ["liveAgents"],
    queryFn: async (): Promise<LiveAgent[]> => {
      if (!publicClient) return [];
      const registryAddress = CONTRACT_ADDRESSES.agentRegistry as Address;

      const logs = await getLogsWindowed(publicClient, {
        address: registryAddress,
        event: AGENT_REGISTERED,
      });

      const uniqueAddresses = new Set<Address>();
      logs.forEach((log) => {
        const a = (log as unknown as { args: { agent?: Address } }).args.agent;
        if (a) uniqueAddresses.add(a);
      });

      const addrs = Array.from(uniqueAddresses);
      if (addrs.length === 0) return [];

      const calls = addrs.map((address) => ({
        address: registryAddress,
        abi: AGENT_REGISTRY_ABI,
        functionName: "getAgent",
        args: [address],
      }));

      const results = await publicClient.multicall({ contracts: calls as never });

      const agents: LiveAgent[] = [];
      results.forEach((res, i) => {
        if (res.status === "success" && res.result) {
          const agentData = res.result as {
            owner: string;
            agentId: `0x${string}`;
            stakedAmount: bigint;
            reputation: bigint;
            tasksCompleted: bigint;
            totalEarned: bigint;
            slashed: boolean;
            active: boolean;
          };
          const address = addrs[i];
          const rawName = getAgentLabel(agentData.agentId, address);
          const op = rawName.split("-")[0] || "Custom";
          agents.push({
            id: address,
            name: rawName,
            op,
            owner: agentData.owner,
            reputation: Number(agentData.reputation),
            stake: formatEther(agentData.stakedAmount),
            jobs: Number(agentData.tasksCompleted),
            earned: formatEther(agentData.totalEarned),
            active: agentData.active,
          });
        }
      });
      return agents;
    },
    enabled: !!publicClient,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
}

// ─── DAGs ─────────────────────────────────────────────────────────────────────
export type LiveDAG = {
  id: string;
  title: string;
  owner: string;
  totalBudget: string;
  nodeCount: number;
  submittedAtBlock: number;
  complete: boolean;
};

const DAG_SUBMITTED = parseAbiItem(
  "event DAGSubmitted(bytes32 indexed dagRoot, address requester, uint256 nodeCount, uint256 budget)",
);

export function useLiveDAGs() {
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: ["liveDAGs"],
    queryFn: async (): Promise<LiveDAG[]> => {
      if (!publicClient) return [];
      const dagRegAddress = CONTRACT_ADDRESSES.taskDagRegistry as Address;

      const logs = await getLogsWindowed(publicClient, {
        address: dagRegAddress,
        event: DAG_SUBMITTED,
      });

      const uniqueRoots = new Set<string>();
      logs.forEach((log) => {
        const r = (log as unknown as { args: { dagRoot?: string } }).args.dagRoot;
        if (r) uniqueRoots.add(r);
      });

      const roots = Array.from(uniqueRoots);
      if (roots.length === 0) return [];

      const calls = roots.map((root) => ({
        address: dagRegAddress,
        abi: TASK_DAG_REGISTRY_ABI,
        functionName: "getDAG",
        args: [root],
      }));

      const results = await publicClient.multicall({ contracts: calls as never });

      const dags: LiveDAG[] = [];
      results.forEach((res, i) => {
        if (res.status === "success" && res.result) {
          const dagData = res.result as {
            dagRoot: string;
            requester: string;
            totalBudget: bigint;
            submittedAt: bigint;
            nodeCount: bigint;
            complete: boolean;
          };
          const root = roots[i];
          const shortRoot = `${root.slice(0, 10)}...${root.slice(-4)}`;
          dags.push({
            id: root,
            title: `Task-${shortRoot}`,
            owner: dagData.requester,
            totalBudget: formatEther(dagData.totalBudget),
            nodeCount: Number(dagData.nodeCount),
            submittedAtBlock: Number(dagData.submittedAt),
            complete: dagData.complete,
          });
        }
      });
      return dags.sort((a, b) => b.submittedAtBlock - a.submittedAtBlock);
    },
    enabled: !!publicClient,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
}

// ─── DAG details ──────────────────────────────────────────────────────────────
export type LiveDAGNode = {
  id: string;
  label: string;
  type: string;
  status: string;
  budget: number;
  payout?: number;
  agentId?: string;
  agentName?: string;
  deps: string[];
  score?: number;
};

const NODE_TYPES = ["SEQUENTIAL", "PARALLEL", "CONDITIONAL", "REDUCE"];
const STATUS_MAP = ["Pending", "Bidding", "Executing", "Executing", "Settled", "Failed"];

const VERIFICATION_SUBMITTED = parseAbiItem(
  "event VerificationSubmitted(bytes32 indexed taskId, address indexed agent, uint8 score, uint256 payout)",
);

export function useDAGDetails(dagRoot: string) {
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: ["dagDetails", dagRoot],
    queryFn: async () => {
      if (!publicClient || !dagRoot) return { nodes: [], edges: [] };

      const dagRegAddress = CONTRACT_ADDRESSES.taskDagRegistry as Address;
      const teeAddress = CONTRACT_ADDRESSES.teeVerifierBridge as Address;

      const rawNodes = (await publicClient.readContract({
        address: dagRegAddress,
        abi: TASK_DAG_REGISTRY_ABI,
        functionName: "getDAGNodes",
        args: [dagRoot],
      })) as Array<{
        taskId: string;
        nodeType: number;
        status: number;
        maxBudget: bigint;
        assignedAgent: string;
        dependsOn: readonly string[];
      }>;

      const logs = await getLogsWindowed(publicClient, {
        address: teeAddress,
        event: VERIFICATION_SUBMITTED,
      });

      const verifications = new Map<string, { score: number; payout: number }>();
      logs.forEach((l) => {
        const a = (l as unknown as { args: { taskId?: string; score?: number; payout?: bigint } })
          .args;
        if (a.taskId && a.score !== undefined && a.payout !== undefined) {
          verifications.set(a.taskId, {
            score: Number(a.score),
            payout: Number(formatEther(a.payout)),
          });
        }
      });

      const nodes: LiveDAGNode[] = rawNodes.map((n) => {
        const id = n.taskId;
        const verif = verifications.get(id);
        const hasAgent = n.assignedAgent !== "0x0000000000000000000000000000000000000000";
        return {
          id,
          label: `Task-${id.slice(2, 6)}`,
          type: NODE_TYPES[n.nodeType] || "SEQUENTIAL",
          status: STATUS_MAP[n.status] || "Pending",
          budget: Number(formatEther(n.maxBudget)),
          payout: verif?.payout,
          score: verif?.score,
          agentId: hasAgent ? n.assignedAgent : undefined,
          agentName: hasAgent ? `${n.assignedAgent.slice(0, 6)}...` : undefined,
          deps: Array.from(n.dependsOn || []) as string[],
        };
      });

      const edges: [string, string][] = [];
      nodes.forEach((n) => n.deps.forEach((depId) => edges.push([depId, n.id])));

      return { nodes, edges };
    },
    enabled: !!publicClient && !!dagRoot,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
}

// ─── Attestations ─────────────────────────────────────────────────────────────
export type AgentAttestation = {
  taskId: string;
  score: number;
  payout: string;
  blockNumber: number;
};

export function useAgentAttestations(agentAddress: string) {
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: ["agentAttestations", agentAddress],
    queryFn: async (): Promise<AgentAttestation[]> => {
      if (!publicClient || !agentAddress) return [];
      const teeAddress = CONTRACT_ADDRESSES.teeVerifierBridge as Address;

      const logs = await getLogsWindowed(publicClient, {
        address: teeAddress,
        event: VERIFICATION_SUBMITTED,
        eventArgs: { agent: agentAddress as Address },
      });

      return logs
        .map((l) => {
          const a = (
            l as unknown as {
              args: { taskId?: string; score?: number; payout?: bigint };
              blockNumber: bigint;
            }
          ).args;
          const blockNumber = Number((l as unknown as { blockNumber: bigint }).blockNumber);
          return {
            taskId: a.taskId as string,
            score: Number(a.score),
            payout: formatEther(a.payout || 0n),
            blockNumber,
          };
        })
        .sort((a, b) => b.blockNumber - a.blockNumber);
    },
    enabled: !!publicClient && !!agentAddress,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
}

export function useGlobalSettlements() {
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: ["globalSettlements"],
    queryFn: async () => {
      if (!publicClient) return [];
      const teeAddress = CONTRACT_ADDRESSES.teeVerifierBridge as Address;

      const logs = await getLogsWindowed(publicClient, {
        address: teeAddress,
        event: VERIFICATION_SUBMITTED,
      });

      return logs
        .map((l) => {
          const a = (
            l as unknown as {
              args: { taskId?: string; agent?: string; score?: number; payout?: bigint };
            }
          ).args;
          const blockNumber = Number((l as unknown as { blockNumber: bigint }).blockNumber);
          return {
            taskId: a.taskId as string,
            agent: a.agent as string,
            score: Number(a.score),
            payout: formatEther(a.payout || 0n),
            blockNumber,
            timestamp: Date.now(),
          };
        })
        .sort((a, b) => b.blockNumber - a.blockNumber);
    },
    enabled: !!publicClient,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
}
