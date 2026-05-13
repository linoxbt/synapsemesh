import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { parseAbiItem, hexToString, formatEther, type Address } from 'viem';
import { CONTRACT_ADDRESSES, AGENT_REGISTRY_ABI, TASK_DAG_REGISTRY_ABI } from './contracts';

export type LiveAgent = {
  id: string; // The address
  name: string; // Decoded from bytes32 agentId
  op: string; // Parsed from name (e.g. Researcher)
  owner: string;
  reputation: number;
  stake: string; // In OG
  jobs: number;
  earned: string;
  active: boolean;
};

export function useLiveAgents() {
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: ['liveAgents'],
    queryFn: async (): Promise<LiveAgent[]> => {
      if (!publicClient) return [];
      
      const registryAddress = CONTRACT_ADDRESSES.agentRegistry as Address;
      
      // 1. Fetch all AgentRegistered events
      const logs = await publicClient.getLogs({
        address: registryAddress,
        event: parseAbiItem('event AgentRegistered(address indexed agent, bytes32 agentId, uint256 stake)'),
        fromBlock: 0n,
        toBlock: 'latest',
      });

      // 2. Extract unique agent addresses (in case of re-registration, keep latest)
      const uniqueAddresses = new Set<Address>();
      logs.forEach(log => {
        if (log.args.agent) uniqueAddresses.add(log.args.agent);
      });

      const agents: LiveAgent[] = [];

      // 3. Multicall getAgent() for all unique addresses
      const calls = Array.from(uniqueAddresses).map(address => ({
        address: registryAddress,
        abi: AGENT_REGISTRY_ABI,
        functionName: 'getAgent',
        args: [address],
      }));

      if (calls.length === 0) return [];

      const results = await publicClient.multicall({
        contracts: calls as any,
      });

      results.forEach((res, i) => {
        if (res.status === 'success' && res.result) {
          const agentData = res.result as any;
          const address = Array.from(uniqueAddresses)[i];
          
          // agentData is a tuple matching Agent struct
          // { owner, agentId, stakedAmount, reputation, tasksCompleted, totalEarned, slashed, active }
          
          // Decode bytes32 to string and clean null bytes
          const rawName = hexToString(agentData.agentId).replace(/\0/g, '');
          const op = rawName.split('-')[0] || 'Custom';
          
          agents.push({
            id: address,
            name: rawName,
            op: op,
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
    refetchInterval: 10000,
  });
}

export type LiveDAG = {
  id: string; // The bytes32 dagRoot
  title: string; // Decoded from bytes32
  owner: string;
  totalBudget: string; // In OG
  nodeCount: number;
  submittedAtBlock: number;
  complete: boolean;
};

export function useLiveDAGs() {
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: ['liveDAGs'],
    queryFn: async (): Promise<LiveDAG[]> => {
      if (!publicClient) return [];
      
      const dagRegAddress = CONTRACT_ADDRESSES.taskDagRegistry as Address;
      
      const logs = await publicClient.getLogs({
        address: dagRegAddress,
        event: parseAbiItem('event DAGSubmitted(bytes32 indexed dagRoot, address requester, uint256 nodeCount, uint256 budget)'),
        fromBlock: 0n,
        toBlock: 'latest',
      });

      const uniqueRoots = new Set<string>();
      logs.forEach(log => {
        if (log.args.dagRoot) uniqueRoots.add(log.args.dagRoot);
      });

      const dags: LiveDAG[] = [];

      // Multicall getDAG() for all unique dagRoots
      const calls = Array.from(uniqueRoots).map(root => ({
        address: dagRegAddress,
        abi: TASK_DAG_REGISTRY_ABI,
        functionName: 'getDAG',
        args: [root],
      }));

      if (calls.length === 0) return [];

      const results = await publicClient.multicall({
        contracts: calls as any,
      });

      results.forEach((res, i) => {
        if (res.status === 'success' && res.result) {
          const dagData = res.result as any;
          const root = Array.from(uniqueRoots)[i];
          
          // dagData: { dagRoot, requester, totalBudget, submittedAt, nodeCount, complete }
          // We stored the title in the bytes32 hash basically, but wait: the hash is keccak256(`${title}-${Date.now()}`)
          // It's impossible to decode the title from the hash. For now, we will display a truncated hash as the title.
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

      // Sort descending by block number (newest first)
      return dags.sort((a, b) => b.submittedAtBlock - a.submittedAtBlock);
    },
    enabled: !!publicClient,
    refetchInterval: 10000,
  });
}

export type LiveDAGNode = {
  id: string; // taskId
  label: string; // Truncated taskId for display
  type: string;
  status: string;
  budget: number;
  payout?: number;
  agentId?: string;
  agentName?: string;
  deps: string[]; // dependsOn array
  score?: number;
};

const NODE_TYPES = ["SEQUENTIAL", "PARALLEL", "CONDITIONAL", "REDUCE"];
const STATUS_MAP = ["Pending", "Bidding", "Executing", "Executing", "Settled", "Failed"];

export function useDAGDetails(dagRoot: string) {
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: ["dagDetails", dagRoot],
    queryFn: async () => {
      if (!publicClient || !dagRoot) return { nodes: [], edges: [] };
      
      const dagRegAddress = CONTRACT_ADDRESSES.taskDagRegistry as Address;
      const teeAddress = CONTRACT_ADDRESSES.teeVerifierBridge as Address;

      // 1. Fetch raw nodes
      const rawNodes = await publicClient.readContract({
        address: dagRegAddress,
        abi: TASK_DAG_REGISTRY_ABI,
        functionName: "getDAGNodes",
        args: [dagRoot],
      }) as any[];

      // 2. Fetch Verification events for payout/score
      const logs = await publicClient.getLogs({
        address: teeAddress,
        event: parseAbiItem("event VerificationSubmitted(bytes32 indexed taskId, address indexed agent, uint8 score, uint256 payout)"),
        fromBlock: 0n,
        toBlock: "latest",
      });

      const verifications = new Map<string, { score: number, payout: number }>();
      logs.forEach(l => {
        if (l.args.taskId && l.args.score !== undefined && l.args.payout !== undefined) {
          verifications.set(l.args.taskId, {
            score: Number(l.args.score),
            payout: Number(formatEther(l.args.payout))
          });
        }
      });

      // 3. Format nodes
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

      // 4. Extract edges [from, to] (deps means "to" depends on "from")
      const edges: [string, string][] = [];
      nodes.forEach(n => {
        n.deps.forEach(depId => {
          edges.push([depId, n.id]);
        });
      });

      return { nodes, edges };
    },
    enabled: !!publicClient && !!dagRoot,
    refetchInterval: 5000,
  });
}


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

      const logs = await publicClient.getLogs({
        address: teeAddress,
        event: parseAbiItem("event VerificationSubmitted(bytes32 indexed taskId, address indexed agent, uint8 score, uint256 payout)"),
        args: {
          agent: agentAddress as Address
        },
        fromBlock: 0n,
        toBlock: "latest",
      });

      const attestations: AgentAttestation[] = logs.map(l => ({
        taskId: l.args.taskId as string,
        score: Number(l.args.score),
        payout: formatEther(l.args.payout || 0n),
        blockNumber: Number(l.blockNumber)
      }));

      // Return descending order
      return attestations.sort((a, b) => b.blockNumber - a.blockNumber);
    },
    enabled: !!publicClient && !!agentAddress,
    refetchInterval: 10000,
  });
}


export function useGlobalSettlements() {
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: ["globalSettlements"],
    queryFn: async (): Promise<AgentAttestation[]> => {
      if (!publicClient) return [];
      
      const teeAddress = CONTRACT_ADDRESSES.teeVerifierBridge as Address;

      const logs = await publicClient.getLogs({
        address: teeAddress,
        event: parseAbiItem("event VerificationSubmitted(bytes32 indexed taskId, address indexed agent, uint8 score, uint256 payout)"),
        fromBlock: 0n,
        toBlock: "latest",
      });

      const attestations = logs.map(l => ({
        taskId: l.args.taskId as string,
        agent: l.args.agent as string,
        score: Number(l.args.score),
        payout: formatEther(l.args.payout || 0n),
        blockNumber: Number(l.blockNumber),
        timestamp: Date.now() // For sorting/display in absence of block timestamp without extra queries
      }));

      return attestations.sort((a, b) => b.blockNumber - a.blockNumber);
    },
    enabled: !!publicClient,
    refetchInterval: 10000,
  });
}

