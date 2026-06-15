import { useQuery } from "@tanstack/react-query";
import { usePublicClient, type UsePublicClientReturnType } from "wagmi";
import {
  parseAbiItem,
  hexToString,
  formatEther,
  type Address,
  type AbiEvent,
} from "viem";
import { CONTRACT_ADDRESSES, AGENT_REGISTRY_ABI, TASK_DAG_REGISTRY_ABI } from "./contracts";
import { SEEDED_AGENTS, SEEDED_DAGS, getSeededDAGDetails } from "./seedData";

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
  avatarURI?: string;
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
      if (!publicClient) return SEEDED_AGENTS;
      const registryAddress = CONTRACT_ADDRESSES.agentRegistry as Address;
      if (!deployed(registryAddress)) return SEEDED_AGENTS;

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
      if (addrs.length === 0) return SEEDED_AGENTS;

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
      return mergeAgents(agents).sort((a, b) => {
        if (a.hasReadableProfile !== b.hasReadableProfile) return a.hasReadableProfile ? -1 : 1;
        return b.reputation - a.reputation;
      });
    },
    enabled: !!publicClient,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
}

function mergeAgents(agents: LiveAgent[]) {
  const seen = new Set(agents.map((agent) => agent.id.toLowerCase()));
  return [...SEEDED_AGENTS.filter((agent) => !seen.has(agent.id.toLowerCase())), ...agents];
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
      if (!publicClient) return SEEDED_DAGS;
      const dagRegAddress = CONTRACT_ADDRESSES.taskDagRegistry as Address;
      if (!deployed(dagRegAddress)) return SEEDED_DAGS;

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
      if (roots.length === 0) return SEEDED_DAGS;

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
      return mergeDAGs(dags).sort((a, b) => b.submittedAtBlock - a.submittedAtBlock);
    },
    enabled: !!publicClient,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
}

function mergeDAGs(dags: LiveDAG[]) {
  const seen = new Set(dags.map((dag) => dag.id.toLowerCase()));
  return [...SEEDED_DAGS.filter((dag) => !seen.has(dag.id.toLowerCase())), ...dags];
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
      const seeded = getSeededDAGDetails(dagRoot);
      if (seeded) return seeded;
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
