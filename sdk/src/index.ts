import { ethers, Signer, Provider, Contract, ContractTransactionResponse } from "ethers";

export interface SDKConfig {
  agentRegistryAddress?: string;
  taskDagRegistryAddress?: string;
  teeVerifierBridgeAddress?: string;
}

const DEFAULT_CONFIG: SDKConfig = {
  agentRegistryAddress: "0x8CDe1A5e466712b133099dCBc3bBFF835eAfBe4d",
  taskDagRegistryAddress: "0x78C08B5d9d72dd3B404eb43EdDEE0f9366d0E812",
  teeVerifierBridgeAddress: "0x4d0DC0C2F32edfD234B8c179e77721bEBF1611cF",
};

const AGENT_REGISTRY_ABI = [
  "function register(bytes32 _agentId) payable",
  "function isRegistered(address _agent) view returns (bool)",
  "function getAgent(address _agent) view returns (tuple(address owner, bytes32 agentId, uint256 stakedAmount, uint32 reputation, uint32 tasksCompleted, uint256 totalEarned, bool slashed, bool active))",
  "event AgentRegistered(address indexed agent, bytes32 agentId, uint256 stake)"
];

const TASK_DAG_REGISTRY_ABI = [
  "function submitDAG(tuple(bytes32 taskId, bytes32 inputSchemaHash, bytes32 outputSchemaHash, bytes32 qualityRubricHash, bytes32[] dependsOn, uint8 nodeType, uint256 maxBudget, uint256 timeoutBlocks)[] _nodes) payable returns (bytes32)",
  "event DAGSubmitted(bytes32 indexed dagRoot, address requester, uint256 nodeCount, uint256 budget)"
];

const TEE_VERIFIER_BRIDGE_ABI = [
  "function submitVerification(bytes32 taskId, address assignedAgent, bool passed, uint8 score, bytes teeSignature) external",
  "event VerificationSubmitted(bytes32 indexed taskId, address indexed agent, uint8 score, uint256 payout)"
];

export interface NodeConfig {
  type: "SEQUENTIAL" | "PARALLEL" | "CONDITIONAL" | "REDUCE";
  maxBudget: bigint;
  dependsOn: number[];
}

export class MeshClient {
  public signerOrProvider: Signer | Provider;
  private agentRegistry: Contract;
  private taskDagRegistry: Contract;
  private teeVerifierBridge: Contract;

  constructor(signerOrProvider: Signer | Provider, config: SDKConfig = {}) {
    this.signerOrProvider = signerOrProvider;
    const finalConfig = { ...DEFAULT_CONFIG, ...config };

    this.agentRegistry = new Contract(finalConfig.agentRegistryAddress!, AGENT_REGISTRY_ABI, signerOrProvider);
    this.taskDagRegistry = new Contract(finalConfig.taskDagRegistryAddress!, TASK_DAG_REGISTRY_ABI, signerOrProvider);
    this.teeVerifierBridge = new Contract(finalConfig.teeVerifierBridgeAddress!, TEE_VERIFIER_BRIDGE_ABI, signerOrProvider);
  }

  public get agents() {
    return {
      register: async (params: { name: string; stake: bigint }): Promise<ContractTransactionResponse> => {
        const agentId = ethers.encodeBytes32String(params.name);
        return await this.agentRegistry.register(agentId, { value: params.stake });
      },
      getProfile: async (address: string) => {
        return await this.agentRegistry.getAgent(address);
      }
    };
  }

  public get taskDAG() {
    return {
      submit: async (params: { nodes: NodeConfig[] }): Promise<ContractTransactionResponse> => {
        let totalBudget = 0n;
        const formattedNodes = params.nodes.map((n, i) => {
          totalBudget += n.maxBudget;
          const nodeTypeEnum = ["SEQUENTIAL", "PARALLEL", "CONDITIONAL", "REDUCE"].indexOf(n.type);
          
          return {
            taskId: ethers.id(`node-${Date.now()}-${i}`),
            inputSchemaHash: ethers.ZeroHash,
            outputSchemaHash: ethers.ZeroHash,
            qualityRubricHash: ethers.ZeroHash,
            dependsOn: n.dependsOn.map(depIdx => ethers.id(`node-${Date.now()}-${depIdx}`)), // Requires proper topological sorting in real usage
            nodeType: nodeTypeEnum !== -1 ? nodeTypeEnum : 0,
            maxBudget: n.maxBudget,
            timeoutBlocks: 1000n
          };
        });

        return await this.taskDagRegistry.submitDAG(formattedNodes, { value: totalBudget });
      }
    };
  }

  public get events() {
    return {
      onVerificationSubmitted: (callback: (taskId: string, agent: string, score: number, payout: bigint) => void) => {
        this.teeVerifierBridge.on("VerificationSubmitted", callback);
      },
      removeAllListeners: () => {
        this.teeVerifierBridge.removeAllListeners();
      }
    };
  }
}
