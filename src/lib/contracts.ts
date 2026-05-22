import { type Address, type PublicClient } from "viem";

/**
 * SYNAPSEMESH SMART CONTRACT REGISTRY (0G CHAIN)
 *
 * 13 core protocol contracts. Addresses are read from Vite environment variables
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

  // System 2: Evolution Lab
  fitnessOracle: addr("VITE_CONTRACT_FITNESS_ORACLE"),
  genOps: addr("VITE_CONTRACT_GEN_OPS"),
  modelGenome: addr("VITE_CONTRACT_MODEL_GENOME"),
  evolutionClock: addr("VITE_CONTRACT_EVOLUTION_CLOCK"),
  inferencePool: addr("VITE_CONTRACT_INFERENCE_POOL"),
  genomeMarket: addr("VITE_CONTRACT_GENOME_MARKET"),
  genomeDAO: addr("VITE_CONTRACT_GENOME_DAO"),
} as const;

/** Returns true when a contract address has been deployed (non-zero). */
export function isDeployed(key: keyof typeof CONTRACT_ADDRESSES): boolean {
  return CONTRACT_ADDRESSES[key] !== "0x";
}

import AgentRegistryJson from "./abis/AgentRegistry.json";
import TaskDAGRegistryJson from "./abis/TaskDAGRegistry.json";
import TEEVerifierBridgeJson from "./abis/TEEVerifierBridge.json";

export const AGENT_REGISTRY_ABI = AgentRegistryJson.abi;
export const TASK_DAG_REGISTRY_ABI = TaskDAGRegistryJson.abi;
export const TEE_VERIFIER_BRIDGE_ABI = TEEVerifierBridgeJson.abi;

// The rest of the functions can remain or be removed later, for now we just export the real ABIs.
