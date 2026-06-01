import { useQuery } from "@tanstack/react-query";
import { usePublicClient, type UsePublicClientReturnType } from "wagmi";
import {
  parseAbiItem,
  hexToString,
  formatEther,
  keccak256,
  toHex,
  type Address,
  type AbiEvent,
  type Abi,
} from "viem";
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
type MulticallResult = { status: "success" | "failure"; result?: unknown };

export { getLogsWindowed };

function deployed(address: Address) {
  return address !== "0x";
}

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
  capabilities: string[];
  endpoint: string;
  metadataURI: string;
  owner: string;
  reputation: number;
  stake: string;
  jobs: number;
  earned: string;
  active: boolean;
  hasReadableProfile: boolean;
};

const AGENT_REGISTERED = parseAbiItem(
  "event AgentRegistered(address indexed agent, bytes32 agentId, uint256 stake)",
);
const AGENT_PROFILE_UPDATED = parseAbiItem(
  "event AgentProfileUpdated(address indexed agent, bytes32 indexed agentId, string name, string operation, string[] capabilities, string endpoint, string metadataURI)",
);

function decodeBytes32Label(agentId: `0x${string}`) {
  try {
    const decoded = hexToString(agentId).replace(/\0/g, "").trim();
    if (/^[\x20-\x7E]+$/.test(decoded) && decoded.length > 0) return decoded;
  } catch {
    // Some legacy registrations use keccak256(name), which is intentionally opaque.
  }
  return "";
}

function profileFromLabel(label: string) {
  const [maybeOp, ...rest] = label.split(":");
  if (rest.length > 0) {
    const name = rest.join(":").replace(/[-_]+/g, " ").trim();
    return {
      name: name.length > 0 ? titleCase(name) : label,
      op: maybeOp || "Custom",
      capabilities: defaultCapabilities(maybeOp || "Custom"),
    };
  }

  const [prefix, ...nameParts] = label.split("-");
  if (nameParts.length > 0 && prefix.length <= 16) {
    return {
      name: titleCase(nameParts.join(" ")),
      op: prefix || "Custom",
      capabilities: defaultCapabilities(prefix || "Custom"),
    };
  }

  return {
    name: titleCase(label.replace(/[-_]+/g, " ")),
    op: "Custom",
    capabilities: defaultCapabilities("Custom"),
  };
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function defaultCapabilities(op: string) {
  const map: Record<string, string[]> = {
    Researcher: ["source discovery", "market mapping", "evidence synthesis"],
    Writer: ["technical writing", "brief generation", "editing"],
    Verifier: ["rubric scoring", "attestation review", "quality control"],
    Vision: ["image inspection", "visual QA", "scene analysis"],
    Aggregator: ["result merging", "consensus", "DAG coordination"],
    Coder: ["code review", "test generation", "implementation"],
    Custom: ["custom execution", "tool use", "reporting"],
  };
  return map[op] ?? map.Custom;
}

export function useLiveAgents() {
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: ["liveAgents"],
    queryFn: async (): Promise<LiveAgent[]> => {
      if (!publicClient) return [];
      const registryAddress = CONTRACT_ADDRESSES.agentRegistry as Address;
      if (!deployed(registryAddress)) return [];

      const logs = await getLogsWindowed(publicClient, {
        address: registryAddress,
        event: AGENT_REGISTERED,
      });
      const profileLogs = await getLogsWindowed(publicClient, {
        address: registryAddress,
        event: AGENT_PROFILE_UPDATED,
      });

      const profiles = new Map<
        string,
        {
          agentId: `0x${string}`;
          name: string;
          operation: string;
          capabilities: string[];
          endpoint: string;
          metadataURI: string;
          blockNumber: bigint;
          logIndex: number;
        }
      >();

      profileLogs.forEach((log) => {
        const args = (
          log as unknown as {
            args: {
              agent?: Address;
              agentId?: `0x${string}`;
              name?: string;
              operation?: string;
              capabilities?: readonly string[];
              endpoint?: string;
              metadataURI?: string;
            };
            blockNumber: bigint;
            logIndex: number;
          }
        ).args;
        if (!args.agent || !args.agentId) return;

        const key = args.agent.toLowerCase();
        const current = profiles.get(key);
        const blockNumber = (log as unknown as { blockNumber: bigint }).blockNumber;
        const logIndex = Number((log as unknown as { logIndex: number }).logIndex ?? 0);
        if (
          current &&
          (current.blockNumber > blockNumber ||
            (current.blockNumber === blockNumber && current.logIndex > logIndex))
        ) {
          return;
        }
        profiles.set(key, {
          agentId: args.agentId,
          name: args.name || "",
          operation: args.operation || "Custom",
          capabilities: Array.from(args.capabilities || []),
          endpoint: args.endpoint || "",
          metadataURI: args.metadataURI || "",
          blockNumber,
          logIndex,
        });
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

      const results = (await publicClient.multicall({
        contracts: calls,
      })) as MulticallResult[];

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
          const profile = profiles.get(address.toLowerCase());
          const decodedLabel = decodeBytes32Label(agentData.agentId);
          const labelProfile = decodedLabel ? profileFromLabel(decodedLabel) : null;
          const hasReadableProfile =
            Boolean(profile?.name.trim()) || Boolean(decodedLabel.trim());
          const op = profile?.operation || labelProfile?.op || "Custom";
          agents.push({
            id: address,
            name: profile?.name || labelProfile?.name || "Unlabeled onchain agent",
            op,
            capabilities:
              profile?.capabilities.length
                ? profile.capabilities
                : labelProfile?.capabilities || defaultCapabilities(op),
            endpoint: profile?.endpoint || "",
            metadataURI: profile?.metadataURI || "",
            owner: agentData.owner,
            reputation: Number(agentData.reputation),
            stake: formatEther(agentData.stakedAmount),
            jobs: Number(agentData.tasksCompleted),
            earned: formatEther(agentData.totalEarned),
            active: agentData.active,
            hasReadableProfile,
          });
        }
      });
      return agents.sort((a, b) => {
        if (a.hasReadableProfile !== b.hasReadableProfile) return a.hasReadableProfile ? -1 : 1;
        return b.reputation - a.reputation;
      });
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
  metadataURI: string;
  owner: string;
  totalBudget: string;
  nodeCount: number;
  submittedAtBlock: number;
  complete: boolean;
  hasReadableMetadata: boolean;
};

const DAG_SUBMITTED = parseAbiItem(
  "event DAGSubmitted(bytes32 indexed dagRoot, address requester, uint256 nodeCount, uint256 budget)",
);
const DAG_METADATA_SUBMITTED = parseAbiItem(
  "event DAGMetadataSubmitted(bytes32 indexed dagRoot, string title, string metadataURI)",
);
const NODE_METADATA_SUBMITTED = parseAbiItem(
  "event NodeMetadataSubmitted(bytes32 indexed dagRoot, bytes32 indexed taskId, string label, string inputSchemaURI, string outputSchemaURI, string qualityRubricURI)",
);

export function useLiveDAGs() {
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: ["liveDAGs"],
    queryFn: async (): Promise<LiveDAG[]> => {
      if (!publicClient) return [];
      const dagRegAddress = CONTRACT_ADDRESSES.taskDagRegistry as Address;
      if (!deployed(dagRegAddress)) return [];

      const logs = await getLogsWindowed(publicClient, {
        address: dagRegAddress,
        event: DAG_SUBMITTED,
      });
      const metadataLogs = await getLogsWindowed(publicClient, {
        address: dagRegAddress,
        event: DAG_METADATA_SUBMITTED,
      });

      const metadata = new Map<
        string,
        { title: string; metadataURI: string; blockNumber: bigint; logIndex: number }
      >();
      metadataLogs.forEach((log) => {
        const args = (
          log as unknown as {
            args: { dagRoot?: string; title?: string; metadataURI?: string };
            blockNumber: bigint;
            logIndex: number;
          }
        ).args;
        if (!args.dagRoot) return;
        const blockNumber = (log as unknown as { blockNumber: bigint }).blockNumber;
        const logIndex = Number((log as unknown as { logIndex: number }).logIndex ?? 0);
        const current = metadata.get(args.dagRoot);
        if (
          current &&
          (current.blockNumber > blockNumber ||
            (current.blockNumber === blockNumber && current.logIndex > logIndex))
        ) {
          return;
        }
        metadata.set(args.dagRoot, {
          title: args.title || "",
          metadataURI: args.metadataURI || "",
          blockNumber,
          logIndex,
        });
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

      const results = (await publicClient.multicall({
        contracts: calls,
      })) as MulticallResult[];

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
          const meta = metadata.get(root);
          dags.push({
            id: root,
            title: meta?.title || `Task DAG ${shortRoot}`,
            metadataURI: meta?.metadataURI || "",
            owner: dagData.requester,
            totalBudget: formatEther(dagData.totalBudget),
            nodeCount: Number(dagData.nodeCount),
            submittedAtBlock: Number(dagData.submittedAt),
            complete: dagData.complete,
            hasReadableMetadata: Boolean(meta?.title),
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
  inputSchemaURI?: string;
  outputSchemaURI?: string;
  qualityRubricURI?: string;
};

const NODE_TYPES = ["SEQUENTIAL", "PARALLEL", "CONDITIONAL", "REDUCE"];
const STATUS_MAP = ["Pending", "Bidding", "Executing", "Executing", "Settled", "Failed"];

const VERIFICATION_SUBMITTED = parseAbiItem(
  "event VerificationSubmitted(bytes32 indexed taskId, address indexed agent, bool passed, uint8 score, uint256 payout)",
);

export function useDAGDetails(dagRoot: string) {
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: ["dagDetails", dagRoot],
    queryFn: async () => {
      if (!publicClient || !dagRoot) return { nodes: [], edges: [] };

      const dagRegAddress = CONTRACT_ADDRESSES.taskDagRegistry as Address;
      const teeAddress = CONTRACT_ADDRESSES.teeVerifierBridge as Address;
      if (!deployed(dagRegAddress)) return { nodes: [], edges: [] };

      const taskIds = (await publicClient.readContract({
        address: dagRegAddress,
        abi: TASK_DAG_REGISTRY_ABI,
        functionName: "getDAGNodes",
        args: [dagRoot as `0x${string}`],
      })) as `0x${string}`[];

      const nodeResults = (await publicClient.multicall({
        contracts: taskIds.map((taskId) => ({
          address: dagRegAddress,
          abi: TASK_DAG_REGISTRY_ABI,
          functionName: "getNode",
          args: [taskId],
        })),
      })) as MulticallResult[];

      const rawNodes = nodeResults
        .map((res) => (res.status === "success" ? res.result : null))
        .filter(Boolean) as Array<{
        taskId: string;
        nodeType: number;
        status: number;
        maxBudget: bigint;
        assignedAgent: string;
        dependsOn: readonly string[];
      }>;

      const logs = deployed(teeAddress)
        ? await getLogsWindowed(publicClient, {
            address: teeAddress,
            event: VERIFICATION_SUBMITTED,
          })
        : [];
      const nodeMetadataLogs = await getLogsWindowed(publicClient, {
        address: dagRegAddress,
        event: NODE_METADATA_SUBMITTED,
        eventArgs: { dagRoot: dagRoot as `0x${string}` },
      });

      const verifications = new Map<string, { passed: boolean; score: number; payout: number }>();
      logs.forEach((l) => {
        const a = (
          l as unknown as {
            args: { taskId?: string; passed?: boolean; score?: number; payout?: bigint };
          }
        ).args;
        if (a.taskId && a.score !== undefined && a.payout !== undefined) {
          verifications.set(a.taskId, {
            passed: Boolean(a.passed),
            score: Number(a.score),
            payout: Number(formatEther(a.payout)),
          });
        }
      });

      const nodeMetadata = new Map<
        string,
        {
          label: string;
          inputSchemaURI: string;
          outputSchemaURI: string;
          qualityRubricURI: string;
          blockNumber: bigint;
          logIndex: number;
        }
      >();
      nodeMetadataLogs.forEach((l) => {
        const args = (
          l as unknown as {
            args: {
              taskId?: string;
              label?: string;
              inputSchemaURI?: string;
              outputSchemaURI?: string;
              qualityRubricURI?: string;
            };
            blockNumber: bigint;
            logIndex: number;
          }
        ).args;
        if (!args.taskId) return;
        const blockNumber = (l as unknown as { blockNumber: bigint }).blockNumber;
        const logIndex = Number((l as unknown as { logIndex: number }).logIndex ?? 0);
        const current = nodeMetadata.get(args.taskId);
        if (
          current &&
          (current.blockNumber > blockNumber ||
            (current.blockNumber === blockNumber && current.logIndex > logIndex))
        ) {
          return;
        }
        nodeMetadata.set(args.taskId, {
          label: args.label || "",
          inputSchemaURI: args.inputSchemaURI || "",
          outputSchemaURI: args.outputSchemaURI || "",
          qualityRubricURI: args.qualityRubricURI || "",
          blockNumber,
          logIndex,
        });
      });

      const nodes: LiveDAGNode[] = rawNodes.map((n) => {
        const id = n.taskId;
        const verif = verifications.get(id);
        const meta = nodeMetadata.get(id);
        const hasAgent = n.assignedAgent !== "0x0000000000000000000000000000000000000000";
        return {
          id,
          label: meta?.label || `Task ${id.slice(2, 8)}`,
          type: NODE_TYPES[n.nodeType] || "SEQUENTIAL",
          status: STATUS_MAP[n.status] || "Pending",
          budget: Number(formatEther(n.maxBudget)),
          payout: verif?.payout,
          score: verif?.score,
          agentId: hasAgent ? n.assignedAgent : undefined,
          agentName: hasAgent ? `${n.assignedAgent.slice(0, 6)}...` : undefined,
          inputSchemaURI: meta?.inputSchemaURI,
          outputSchemaURI: meta?.outputSchemaURI,
          qualityRubricURI: meta?.qualityRubricURI,
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
  passed: boolean;
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
      if (!deployed(teeAddress)) return [];

      const logs = await getLogsWindowed(publicClient, {
        address: teeAddress,
        event: VERIFICATION_SUBMITTED,
        eventArgs: { agent: agentAddress as Address },
      });

      return logs
        .map((l) => {
          const a = (
            l as unknown as {
              args: { taskId?: string; passed?: boolean; score?: number; payout?: bigint };
              blockNumber: bigint;
            }
          ).args;
          const blockNumber = Number((l as unknown as { blockNumber: bigint }).blockNumber);
          return {
            taskId: a.taskId as string,
            passed: Boolean(a.passed),
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
      if (!deployed(teeAddress)) return [];

      const logs = await getLogsWindowed(publicClient, {
        address: teeAddress,
        event: VERIFICATION_SUBMITTED,
      });

      return logs
        .map((l) => {
          const a = (
            l as unknown as {
              args: {
                taskId?: string;
                agent?: string;
                passed?: boolean;
                score?: number;
                payout?: bigint;
              };
            }
          ).args;
          const blockNumber = Number((l as unknown as { blockNumber: bigint }).blockNumber);
          return {
            taskId: a.taskId as string,
            agent: a.agent as string,
            passed: Boolean(a.passed),
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

// ─── Evolution Lab ───────────────────────────────────────────────────────────
export const MODEL_GENOME_ABI = [
  {
    type: "function",
    name: "mintSeedGenome",
    stateMutability: "payable",
    inputs: [
      { name: "baseModelId", type: "bytes32" },
      { name: "adapterStorageRoot", type: "bytes32" },
      { name: "speciesId", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getGenome",
    stateMutability: "view",
    inputs: [{ name: "genomeId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "genomeId", type: "uint256" },
          { name: "baseModelId", type: "bytes32" },
          { name: "adapterStorageRoot", type: "bytes32" },
          { name: "parentIds", type: "uint256[]" },
          { name: "generation", type: "uint32" },
          { name: "fitnessScore", type: "uint8" },
          { name: "lineageRoot", type: "bytes32" },
          { name: "status", type: "uint8" },
          { name: "inferenceRevenue", type: "uint256" },
          { name: "mintedAt", type: "uint256" },
          { name: "speciesId", type: "bytes32" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "mintFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "GenomeMinted",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: false },
      { name: "speciesId", type: "bytes32", indexed: false },
      { name: "generation", type: "uint32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "FitnessUpdated",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "score", type: "uint8", indexed: false },
      { name: "blockNumber", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "GenomeDeployed",
    inputs: [{ name: "id", type: "uint256", indexed: true }],
  },
  {
    type: "event",
    name: "RevenueAccrued",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AdapterRootUpdated",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "adapterStorageRoot", type: "bytes32", indexed: false },
    ],
  },
] as const satisfies Abi;

export const FITNESS_ORACLE_ABI = [
  {
    type: "function",
    name: "requestEvaluation",
    stateMutability: "nonpayable",
    inputs: [{ name: "genomeId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "blocksUntilNextEval",
    stateMutability: "view",
    inputs: [{ name: "genomeId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "EvaluationRequested",
    inputs: [
      { name: "genomeId", type: "uint256", indexed: true },
      { name: "blockNumber", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "FitnessSubmitted",
    inputs: [
      { name: "genomeId", type: "uint256", indexed: true },
      { name: "score", type: "uint8", indexed: false },
      { name: "benchmarkHash", type: "bytes32", indexed: false },
    ],
  },
] as const satisfies Abi;

export const GEN_OPS_ABI = [
  {
    type: "function",
    name: "crossover",
    stateMutability: "payable",
    inputs: [
      { name: "parentA", type: "uint256" },
      { name: "parentB", type: "uint256" },
      { name: "childAdapterRoot", type: "bytes32" },
      { name: "childLineageRoot", type: "bytes32" },
      { name: "alpha", type: "uint256" },
    ],
    outputs: [{ name: "childId", type: "uint256" }],
  },
  {
    type: "function",
    name: "breedingFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "mutate",
    stateMutability: "nonpayable",
    inputs: [
      { name: "genomeId", type: "uint256" },
      { name: "newAdapterRoot", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "CrossoverTriggered",
    inputs: [
      { name: "parentA", type: "uint256", indexed: false },
      { name: "parentB", type: "uint256", indexed: false },
      { name: "childId", type: "uint256", indexed: false },
      { name: "alpha", type: "uint256", indexed: false },
      { name: "childAdapterRoot", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "MutationTriggered",
    inputs: [
      { name: "genomeId", type: "uint256", indexed: true },
      { name: "newAdapterRoot", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SelectionRun",
    inputs: [
      { name: "generation", type: "uint256", indexed: false },
      { name: "selectedCount", type: "uint256", indexed: false },
    ],
  },
] as const satisfies Abi;

export const EVOLUTION_CLOCK_ABI = [
  {
    type: "function",
    name: "triggerEpoch",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "blocksUntilNextEpoch",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "currentGeneration",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "EpochTriggered",
    inputs: [
      { name: "generation", type: "uint256", indexed: true },
      { name: "blockNumber", type: "uint256", indexed: false },
      { name: "triggeredBy", type: "address", indexed: false },
    ],
  },
] as const satisfies Abi;

export const INFERENCE_POOL_ABI = [
  {
    type: "function",
    name: "addToPool",
    stateMutability: "nonpayable",
    inputs: [{ name: "genomeId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "distributeRevenue",
    stateMutability: "payable",
    inputs: [{ name: "genomeId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "claimReward",
    stateMutability: "nonpayable",
    inputs: [{ name: "genomeId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getPendingReward",
    stateMutability: "view",
    inputs: [{ name: "genomeId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "isDeployed",
    stateMutability: "view",
    inputs: [{ name: "genomeId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "GenomeDeployedToPool",
    inputs: [{ name: "genomeId", type: "uint256", indexed: true }],
  },
  {
    type: "event",
    name: "RevenueDistributed",
    inputs: [
      { name: "genomeId", type: "uint256", indexed: true },
      { name: "holderAmount", type: "uint256", indexed: false },
      { name: "platformAmount", type: "uint256", indexed: false },
    ],
  },
] as const satisfies Abi;

export const GENOME_MARKET_ABI = [
  {
    type: "function",
    name: "list",
    stateMutability: "nonpayable",
    inputs: [
      { name: "genomeId", type: "uint256" },
      { name: "price", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "buy",
    stateMutability: "payable",
    inputs: [{ name: "genomeId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "setRentalPrice",
    stateMutability: "nonpayable",
    inputs: [
      { name: "genomeId", type: "uint256" },
      { name: "pricePerBlock", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "rent",
    stateMutability: "payable",
    inputs: [
      { name: "genomeId", type: "uint256" },
      { name: "blocks", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getListing",
    stateMutability: "view",
    inputs: [{ name: "genomeId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "seller", type: "address" },
          { name: "price", type: "uint256" },
          { name: "active", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "rentalPrices",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "Listed",
    inputs: [
      { name: "genomeId", type: "uint256", indexed: true },
      { name: "seller", type: "address", indexed: false },
      { name: "price", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Sold",
    inputs: [
      { name: "genomeId", type: "uint256", indexed: true },
      { name: "seller", type: "address", indexed: false },
      { name: "buyer", type: "address", indexed: false },
      { name: "price", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Rented",
    inputs: [
      { name: "genomeId", type: "uint256", indexed: true },
      { name: "renter", type: "address", indexed: false },
      { name: "expiresAt", type: "uint256", indexed: false },
      { name: "totalPaid", type: "uint256", indexed: false },
    ],
  },
] as const satisfies Abi;

export const GENOME_DAO_ABI = [
  {
    type: "function",
    name: "propose",
    stateMutability: "nonpayable",
    inputs: [
      { name: "pType", type: "uint8" },
      { name: "value", type: "uint256" },
      { name: "description", type: "string" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "vote",
    stateMutability: "nonpayable",
    inputs: [
      { name: "proposalId", type: "uint256" },
      { name: "support", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "execute",
    stateMutability: "nonpayable",
    inputs: [{ name: "proposalId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getProposal",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "proposer", type: "address" },
          { name: "pType", type: "uint8" },
          { name: "value", type: "uint256" },
          { name: "description", type: "string" },
          { name: "forVotes", type: "uint256" },
          { name: "againstVotes", type: "uint256" },
          { name: "startBlock", type: "uint256" },
          { name: "endBlock", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "executed", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "event",
    name: "ProposalCreated",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "proposer", type: "address", indexed: false },
      { name: "pType", type: "uint8", indexed: false },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "VoteCast",
    inputs: [
      { name: "proposalId", type: "uint256", indexed: true },
      { name: "voter", type: "address", indexed: false },
      { name: "support", type: "bool", indexed: false },
      { name: "weight", type: "uint256", indexed: false },
    ],
  },
] as const satisfies Abi;

const GENOME_MINTED = parseAbiItem(
  "event GenomeMinted(uint256 indexed id, address owner, bytes32 speciesId, uint32 generation)",
);
const FITNESS_UPDATED = parseAbiItem(
  "event FitnessUpdated(uint256 indexed id, uint8 score, uint256 blockNumber)",
);
const LISTED = parseAbiItem(
  "event Listed(uint256 indexed genomeId, address seller, uint256 price)",
);
const SOLD = parseAbiItem(
  "event Sold(uint256 indexed genomeId, address seller, address buyer, uint256 price)",
);
const DELISTED = parseAbiItem("event Delisted(uint256 indexed genomeId, address seller)");
const RENTED = parseAbiItem(
  "event Rented(uint256 indexed genomeId, address renter, uint256 expiresAt, uint256 totalPaid)",
);
const PROPOSAL_CREATED = parseAbiItem(
  "event ProposalCreated(uint256 indexed id, address proposer, uint8 pType, uint256 value)",
);

export type LiveGenome = {
  id: string;
  owner: string;
  speciesId: string;
  speciesLabel: string;
  generation: number;
  fitnessScore: number;
  status: "ACTIVE" | "EXTINCT" | "DEPLOYED";
  baseModelId: string;
  adapterStorageRoot: string;
  lineageRoot: string;
  inferenceRevenue: string;
  pendingReward: string;
  mintedAtBlock: number;
  listed: boolean;
  listingPrice?: string;
  rentalPrice?: string;
  inPool: boolean;
};

const SPECIES_LABELS: Record<string, string> = Object.fromEntries(
  ["writing", "code", "reasoning", "creative"].map((name) => [keccak256(toHex(name)), name]),
);

function statusName(status: number): LiveGenome["status"] {
  return status === 1 ? "EXTINCT" : status === 2 ? "DEPLOYED" : "ACTIVE";
}

function speciesLabel(speciesId: string) {
  return SPECIES_LABELS[speciesId.toLowerCase()] || `${speciesId.slice(0, 10)}...`;
}

export function useLiveGenomes() {
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: ["liveGenomes"],
    queryFn: async (): Promise<LiveGenome[]> => {
      if (!publicClient) return [];
      const genomeAddress = CONTRACT_ADDRESSES.modelGenome as Address;
      if (!deployed(genomeAddress)) return [];

      const logs = await getLogsWindowed(publicClient, {
        address: genomeAddress,
        event: GENOME_MINTED,
      });

      const ownerById = new Map<string, string>();
      const speciesById = new Map<string, string>();
      logs.forEach((log) => {
        const args = (
          log as unknown as {
            args: { id?: bigint; owner?: string; speciesId?: string; generation?: number };
          }
        ).args;
        if (args.id === undefined || !args.owner || !args.speciesId) return;
        const id = args.id.toString();
        ownerById.set(id, args.owner);
        speciesById.set(id, args.speciesId);
      });

      const ids = Array.from(ownerById.keys());
      if (ids.length === 0) return [];

      const genomeCalls = ids.map((id) => ({
        address: genomeAddress,
        abi: MODEL_GENOME_ABI,
        functionName: "getGenome",
        args: [BigInt(id)],
      }));
      const ownerCalls = ids.map((id) => ({
        address: genomeAddress,
        abi: MODEL_GENOME_ABI,
        functionName: "ownerOf",
        args: [BigInt(id)],
      }));
      const [genomeResults, ownerResults] = (await Promise.all([
        publicClient.multicall({ contracts: genomeCalls }),
        publicClient.multicall({ contracts: ownerCalls }),
      ])) as [MulticallResult[], MulticallResult[]];

      const listed = new Map<string, { seller: string; price: string; active: boolean }>();
      const rentalPrice = new Map<string, string>();
      const marketAddress = CONTRACT_ADDRESSES.genomeMarket as Address;
      if (deployed(marketAddress)) {
        const [listingResults, rentalResults] = (await Promise.all([
          publicClient.multicall({
            contracts: ids.map((id) => ({
              address: marketAddress,
              abi: GENOME_MARKET_ABI,
              functionName: "getListing",
              args: [BigInt(id)],
            })),
          }),
          publicClient.multicall({
            contracts: ids.map((id) => ({
              address: marketAddress,
              abi: GENOME_MARKET_ABI,
              functionName: "rentalPrices",
              args: [BigInt(id)],
            })),
          }),
        ])) as [MulticallResult[], MulticallResult[]];

        listingResults.forEach((res, i) => {
          if (res.status !== "success" || !res.result) return;
          const row = res.result as {
            seller?: string;
            price?: bigint;
            active?: boolean;
          } & readonly [string, bigint, boolean];
          const seller = row.seller ?? row[0];
          const price = row.price ?? row[1];
          const active = row.active ?? row[2];
          if (active) {
            listed.set(ids[i], { seller, price: formatEther(price), active });
          }
        });

        rentalResults.forEach((res, i) => {
          if (res.status !== "success" || !res.result) return;
          const price = res.result as bigint;
          if (price > 0n) rentalPrice.set(ids[i], formatEther(price));
        });
      }

      const pooled = new Map<string, boolean>();
      const pendingReward = new Map<string, string>();
      const poolAddress = CONTRACT_ADDRESSES.inferencePool as Address;
      if (deployed(poolAddress)) {
        const [poolResults, rewardResults] = (await Promise.all([
          publicClient.multicall({
            contracts: ids.map((id) => ({
              address: poolAddress,
              abi: INFERENCE_POOL_ABI,
              functionName: "isDeployed",
              args: [BigInt(id)],
            })),
          }),
          publicClient.multicall({
            contracts: ids.map((id) => ({
              address: poolAddress,
              abi: INFERENCE_POOL_ABI,
              functionName: "getPendingReward",
              args: [BigInt(id)],
            })),
          }),
        ])) as [MulticallResult[], MulticallResult[]];

        poolResults.forEach((res, i) => {
          if (res.status === "success") pooled.set(ids[i], Boolean(res.result));
        });
        rewardResults.forEach((res, i) => {
          if (res.status === "success")
            pendingReward.set(ids[i], formatEther(res.result as bigint));
        });
      }

      const genomes: LiveGenome[] = [];
      genomeResults.forEach((res, i) => {
        if (res.status !== "success" || !res.result) return;
        const id = ids[i];
        const g = res.result as {
          genomeId: bigint;
          baseModelId: string;
          adapterStorageRoot: string;
          generation: number;
          fitnessScore: number;
          lineageRoot: string;
          status: number;
          inferenceRevenue: bigint;
          mintedAt: bigint;
          speciesId: string;
        };
        const listing = listed.get(id);
        const ownerResult = ownerResults[i];
        const currentOwner =
          ownerResult.status === "success"
            ? (ownerResult.result as string)
            : ownerById.get(id) || "0x";
        genomes.push({
          id,
          owner: listing?.active ? listing.seller : currentOwner,
          speciesId: speciesById.get(id) || g.speciesId,
          speciesLabel: speciesLabel(speciesById.get(id) || g.speciesId),
          generation: Number(g.generation),
          fitnessScore: Number(g.fitnessScore),
          status: statusName(Number(g.status)),
          baseModelId: g.baseModelId,
          adapterStorageRoot: g.adapterStorageRoot,
          lineageRoot: g.lineageRoot,
          inferenceRevenue: formatEther(g.inferenceRevenue),
          pendingReward: pendingReward.get(id) || "0",
          mintedAtBlock: Number(g.mintedAt),
          listed: Boolean(listing?.active),
          listingPrice: listing?.price,
          rentalPrice: rentalPrice.get(id),
          inPool: pooled.get(id) || false,
        });
      });

      return genomes.sort((a, b) => Number(b.id) - Number(a.id));
    },
    enabled: !!publicClient,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
}

export type LiveProposal = {
  id: string;
  proposer: string;
  pType: number;
  value: string;
  description: string;
  forVotes: string;
  againstVotes: string;
  endBlock: number;
  status: number;
  executed: boolean;
};

export function useLiveGenomeProposals() {
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: ["liveGenomeProposals"],
    queryFn: async (): Promise<LiveProposal[]> => {
      if (!publicClient) return [];
      const daoAddress = CONTRACT_ADDRESSES.genomeDAO as Address;
      if (!deployed(daoAddress)) return [];

      const logs = await getLogsWindowed(publicClient, {
        address: daoAddress,
        event: PROPOSAL_CREATED,
      });
      const ids = Array.from(
        new Set(
          logs
            .map((log) => (log as unknown as { args: { id?: bigint } }).args.id?.toString())
            .filter(Boolean) as string[],
        ),
      );
      if (ids.length === 0) return [];

      const results = (await publicClient.multicall({
        contracts: ids.map((id) => ({
          address: daoAddress,
          abi: GENOME_DAO_ABI,
          functionName: "getProposal",
          args: [BigInt(id)],
        })),
      })) as MulticallResult[];

      const proposals: LiveProposal[] = [];
      results.forEach((res, i) => {
        if (res.status !== "success" || !res.result) return;
        const p = res.result as {
          id: bigint;
          proposer: string;
          pType: number;
          value: bigint;
          description: string;
          forVotes: bigint;
          againstVotes: bigint;
          endBlock: bigint;
          status: number;
          executed: boolean;
        };
        proposals.push({
          id: ids[i],
          proposer: p.proposer,
          pType: Number(p.pType),
          value: p.value.toString(),
          description: p.description,
          forVotes: p.forVotes.toString(),
          againstVotes: p.againstVotes.toString(),
          endBlock: Number(p.endBlock),
          status: Number(p.status),
          executed: p.executed,
        });
      });

      return proposals.sort((a, b) => Number(b.id) - Number(a.id));
    },
    enabled: !!publicClient,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
}

export function useGenomeMarketActivity() {
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: ["genomeMarketActivity"],
    queryFn: async () => {
      if (!publicClient) return [];
      const marketAddress = CONTRACT_ADDRESSES.genomeMarket as Address;
      if (!deployed(marketAddress)) return [];

      const [listedLogs, soldLogs, delistedLogs, rentedLogs] = await Promise.all([
        getLogsWindowed(publicClient, { address: marketAddress, event: LISTED }),
        getLogsWindowed(publicClient, { address: marketAddress, event: SOLD }),
        getLogsWindowed(publicClient, { address: marketAddress, event: DELISTED }),
        getLogsWindowed(publicClient, { address: marketAddress, event: RENTED }),
      ]);

      return [
        ...listedLogs.map((log) => {
          const args = (
            log as unknown as { args: { genomeId?: bigint; seller?: string; price?: bigint } }
          ).args;
          return {
            kind: "listed",
            genomeId: args.genomeId?.toString() || "0",
            actor: args.seller || "0x",
            amount: formatEther(args.price || 0n),
            blockNumber: Number((log as unknown as { blockNumber: bigint }).blockNumber),
          };
        }),
        ...soldLogs.map((log) => {
          const args = (
            log as unknown as { args: { genomeId?: bigint; buyer?: string; price?: bigint } }
          ).args;
          return {
            kind: "sold",
            genomeId: args.genomeId?.toString() || "0",
            actor: args.buyer || "0x",
            amount: formatEther(args.price || 0n),
            blockNumber: Number((log as unknown as { blockNumber: bigint }).blockNumber),
          };
        }),
        ...delistedLogs.map((log) => {
          const args = (log as unknown as { args: { genomeId?: bigint; seller?: string } }).args;
          return {
            kind: "delisted",
            genomeId: args.genomeId?.toString() || "0",
            actor: args.seller || "0x",
            amount: "0",
            blockNumber: Number((log as unknown as { blockNumber: bigint }).blockNumber),
          };
        }),
        ...rentedLogs.map((log) => {
          const args = (
            log as unknown as { args: { genomeId?: bigint; renter?: string; totalPaid?: bigint } }
          ).args;
          return {
            kind: "rented",
            genomeId: args.genomeId?.toString() || "0",
            actor: args.renter || "0x",
            amount: formatEther(args.totalPaid || 0n),
            blockNumber: Number((log as unknown as { blockNumber: bigint }).blockNumber),
          };
        }),
      ].sort((a, b) => b.blockNumber - a.blockNumber);
    },
    enabled: !!publicClient,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
}
