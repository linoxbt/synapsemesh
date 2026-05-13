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

// ─── ABI stubs ────────────────────────────────────────────────────────────────
// Replace with real compiled ABI JSONs once contracts are deployed.

export const MESH_ESCROW_ABI = [
  {
    name: 'lockBudget',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'dagId',  type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'releasePayout',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'dagId',  type: 'bytes32' },
      { name: 'nodeId', type: 'bytes32' },
      { name: 'agent',  type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'getLockedAmount',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'dagId', type: 'bytes32' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

export const MESH_REGISTRY_ABI = [
  {
    name: 'registerAgent',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'name',     type: 'string' },
      { name: 'op',       type: 'uint8'  },
      { name: 'metadata', type: 'string' },
    ],
    outputs: [{ name: 'tokenId', type: 'uint256' }],
  },
  {
    name: 'getAgent',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentAddr', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'name',       type: 'string'  },
          { name: 'reputation', type: 'uint256' },
          { name: 'stake',      type: 'uint256' },
        ],
      },
    ],
  },
] as const;

export const TASK_DAG_ABI = [
  {
    name: 'submitDAG',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'title', type: 'string' },
      {
        name: 'nodes',
        type: 'tuple[]',
        components: [
          { name: 'label',    type: 'string'  },
          { name: 'nodeType', type: 'uint8'   },
          { name: 'budget',   type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: 'dagId', type: 'bytes32' }],
  },
  {
    name: 'getDAGStatus',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'dagId', type: 'bytes32' }],
    outputs: [{ type: 'uint8' }],
  },
] as const;

// ─── Read helpers ─────────────────────────────────────────────────────────────

export async function getEscrowBalance(
  client: PublicClient,
  dagId: `0x${string}`,
): Promise<bigint> {
  if (!isDeployed('meshEscrow')) return 0n;
  return client.readContract({
    address: CONTRACT_ADDRESSES.meshEscrow,
    abi: MESH_ESCROW_ABI,
    functionName: 'getLockedAmount',
    args: [dagId],
  });
}
