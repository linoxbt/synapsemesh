import { type Address, type PublicClient } from 'viem';

/**
 * SYNAPSEMESH SMART CONTRACT REGISTRY (0G CHAIN)
 *
 * 13 core protocol contracts. Addresses are read from Vite environment variables
 * so they can be set per-deployment (testnet vs mainnet) without code changes.
 *
 * Set the corresponding VITE_CONTRACT_* variables in .env (see .env.example).
 */
const e = (import.meta as { env?: Record<string, string> }).env ?? {};

function addr(key: string): Address {
  const v = e[key];
  return (v && v !== '0x' ? v : '0x') as Address;
}

export const CONTRACT_ADDRESSES = {
  // System 1: Task Economy
  meshEscrow:        addr('VITE_CONTRACT_MESH_ESCROW'),
  agentRegistry:     addr('VITE_CONTRACT_AGENT_REGISTRY'),
  taskDagRegistry:   addr('VITE_CONTRACT_TASK_DAG_REGISTRY'),
  bidEngine:         addr('VITE_CONTRACT_BID_ENGINE'),
  teeVerifierBridge: addr('VITE_CONTRACT_TEE_VERIFIER_BRIDGE'),
  revenueRouter:     addr('VITE_CONTRACT_REVENUE_ROUTER'),

  // System 2: Evolution Lab
  fitnessOracle:     addr('VITE_CONTRACT_FITNESS_ORACLE'),
  genOps:            addr('VITE_CONTRACT_GEN_OPS'),
  modelGenome:       addr('VITE_CONTRACT_MODEL_GENOME'),
  evolutionClock:    addr('VITE_CONTRACT_EVOLUTION_CLOCK'),
  inferencePool:     addr('VITE_CONTRACT_INFERENCE_POOL'),
  genomeMarket:      addr('VITE_CONTRACT_GENOME_MARKET'),
  genomeDAO:         addr('VITE_CONTRACT_GENOME_DAO'),
} as const;

/** Returns true when a contract address has been deployed (non-zero). */
export function isDeployed(key: keyof typeof CONTRACT_ADDRESSES): boolean {
  return CONTRACT_ADDRESSES[key] !== '0x';
}

import AgentRegistryJson from './abis/AgentRegistry.json';
import TaskDAGRegistryJson from './abis/TaskDAGRegistry.json';
import TEEVerifierBridgeJson from './abis/TEEVerifierBridge.json';

export const AGENT_REGISTRY_ABI = AgentRegistryJson.abi;
export const TASK_DAG_REGISTRY_ABI = TaskDAGRegistryJson.abi;
export const TEE_VERIFIER_BRIDGE_ABI = TEEVerifierBridgeJson.abi;

// The rest of the functions can remain or be removed later, for now we just export the real ABIs.
