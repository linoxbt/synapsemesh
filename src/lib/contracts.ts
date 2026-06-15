import { parseAbi, type Address } from "viem";

/**
 * SYNAPSEMESH SMART CONTRACT REGISTRY (0G CHAIN)
 *
 * Task Economy protocol contracts. Addresses are read from Vite environment variables
 * so they can be set per-deployment (testnet vs mainnet) without code changes.
 * For the live SynapseMesh deployment, the registry addresses below are used as
 * defaults so the app still works when local env files are absent.
 *
 * Set the corresponding VITE_CONTRACT_* variables in .env (see .env.example).
 */
const e = (import.meta as { env?: Record<string, string> }).env ?? {};

function addr(key: string, fallback = "0x"): Address {
  const v = e[key];
  return (v && v !== "0x" ? v : fallback) as Address;
}

export const CONTRACT_ADDRESSES = {
  // System 1: Task Economy
  meshEscrow: addr("VITE_CONTRACT_MESH_ESCROW"),
  agentRegistry: addr("VITE_CONTRACT_AGENT_REGISTRY", "0x8CDe1A5e466712b133099dCBc3bBFF835eAfBe4d"),
  taskDagRegistry: addr(
    "VITE_CONTRACT_TASK_DAG_REGISTRY",
    "0x78C08B5d9d72dd3B404eb43EdDEE0f9366d0E812",
  ),
  bidEngine: addr("VITE_CONTRACT_BID_ENGINE"),
  teeVerifierBridge: addr(
    "VITE_CONTRACT_TEE_VERIFIER_BRIDGE",
    "0x4d0DC0C2F32edfD234B8c179e77721bEBF1611cF",
  ),
  revenueRouter: addr("VITE_CONTRACT_REVENUE_ROUTER"),
} as const;

/** Returns true when a contract address has been deployed (non-zero). */
export function isDeployed(key: keyof typeof CONTRACT_ADDRESSES): boolean {
  return CONTRACT_ADDRESSES[key] !== "0x";
}

export const AGENT_REGISTRY_ABI = parseAbi([
  "function register(bytes32 _agentId) payable",
  "function registerWithProfile(bytes32 _agentId, string name, string operation, string[] capabilities, string endpoint, string metadataURI) payable",
  "function updateProfile(string name, string operation, string[] capabilities, string endpoint, string metadataURI)",
  "function deregister()",
  "function getAgent(address _agent) view returns ((address owner, bytes32 agentId, uint256 stakedAmount, uint256 reputation, uint256 tasksCompleted, uint256 totalEarned, bool slashed, bool active))",
  "function getAgentProfile(address _agent) view returns (string name, string operation, string[] capabilities, string endpoint, string metadataURI)",
  "function getReputation(address _agent) view returns (uint256)",
  "function isRegistered(address _agent) view returns (bool)",
  "function MIN_STAKE() view returns (uint256)",
  "event AgentRegistered(address indexed agent, bytes32 agentId, uint256 stake)",
  "event AgentProfileUpdated(address indexed agent, bytes32 indexed agentId, string name, string operation, string[] capabilities, string endpoint, string metadataURI)",
  "event AgentDeregistered(address indexed agent, uint256 stakeReturned)",
  "event ReputationUpdated(address indexed agent, uint256 newScore)",
]);

export const TASK_DAG_REGISTRY_ABI = parseAbi([
  "function submitDAG(bytes32 dagRoot, (bytes32 taskId, bytes32 inputSchemaHash, bytes32 outputSchemaHash, bytes32 qualityRubricHash, bytes32[] dependsOn, uint8 nodeType, uint256 maxBudget, uint256 timeoutBlocks, address assignedAgent, uint8 status, uint256 assignedAt, uint256 completedAt)[] taskNodes) payable",
  "function submitDAGWithMetadata(bytes32 dagRoot, (bytes32 taskId, bytes32 inputSchemaHash, bytes32 outputSchemaHash, bytes32 qualityRubricHash, bytes32[] dependsOn, uint8 nodeType, uint256 maxBudget, uint256 timeoutBlocks, address assignedAgent, uint8 status, uint256 assignedAt, uint256 completedAt)[] taskNodes, string title, string metadataURI, (string label, string inputSchemaURI, string outputSchemaURI, string qualityRubricURI)[] taskMetadata) payable",
  "function getDAG(bytes32 dagRoot) view returns ((bytes32 dagRoot, address requester, uint256 totalBudget, uint256 submittedAt, uint256 nodeCount, bool complete))",
  "function getNode(bytes32 taskId) view returns ((bytes32 taskId, bytes32 inputSchemaHash, bytes32 outputSchemaHash, bytes32 qualityRubricHash, bytes32[] dependsOn, uint8 nodeType, uint256 maxBudget, uint256 timeoutBlocks, address assignedAgent, uint8 status, uint256 assignedAt, uint256 completedAt))",
  "function getDAGNodes(bytes32 dagRoot) view returns (bytes32[])",
  "function dagMetadata(bytes32 dagRoot) view returns (string title, string metadataURI)",
  "function nodeMetadata(bytes32 taskId) view returns (string label, string inputSchemaURI, string outputSchemaURI, string qualityRubricURI)",
  "function getNodeStatus(bytes32 taskId) view returns (uint8)",
  "function dependenciesMet(bytes32 taskId) view returns (bool)",
  "function getAssignedAgent(bytes32 taskId) view returns (address)",
  "event DAGSubmitted(bytes32 indexed dagRoot, address requester, uint256 nodeCount, uint256 budget)",
  "event DAGMetadataSubmitted(bytes32 indexed dagRoot, string title, string metadataURI)",
  "event NodeMetadataSubmitted(bytes32 indexed dagRoot, bytes32 indexed taskId, string label, string inputSchemaURI, string outputSchemaURI, string qualityRubricURI)",
  "event NodeStatusChanged(bytes32 indexed taskId, uint8 newStatus, address agent)",
]);

export const TEE_VERIFIER_BRIDGE_ABI = parseAbi([
  "function submitVerification(bytes32 taskId, address assignedAgent, bool passed, uint8 score, bytes teeSignature)",
  "function trustedMrEnclave() view returns (bytes32)",
  "function trustedVerifierSigner() view returns (address)",
  "function isProcessed(bytes32 taskId) view returns (bool)",
  "function MIN_QUALITY() view returns (uint8)",
  "event VerificationSubmitted(bytes32 indexed taskId, address indexed agent, bool passed, uint8 score, uint256 payout)",
]);
