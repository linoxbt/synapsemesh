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
  // 1. ERC-20 governance/utility token
  meshToken:      addr('VITE_CONTRACT_MESH_TOKEN'),
  // 2. Atomic per-node escrow — holds and releases task budgets
  meshEscrow:     addr('VITE_CONTRACT_MESH_ESCROW'),
  // 3. ERC-7857 INFT registry — onchain agent identities
  meshRegistry:   addr('VITE_CONTRACT_MESH_REGISTRY'),
  // 4. Task DAG submission & state machine
  taskDag:        addr('VITE_CONTRACT_TASK_DAG'),
  // 5. Agent staking & slashing logic
  meshStaking:    addr('VITE_CONTRACT_MESH_STAKING'),
  // 6. TEE attestation verifier — trusted oracle for work verification
  teeVerifier:    addr('VITE_CONTRACT_TEE_VERIFIER'),
  // 7. On-chain governance (proposals & voting)
  meshGovernor:   addr('VITE_CONTRACT_MESH_GOVERNOR'),
  // 8. Protocol treasury — fee accumulation and distribution
  meshTreasury:   addr('VITE_CONTRACT_MESH_TREASURY'),
  // 9. Factory for deploying agent-specific sub-contracts
  meshFactory:    addr('VITE_CONTRACT_MESH_FACTORY'),
  // 10. Price oracle — OG/USD, feeds escrow calculations
  meshOracle:     addr('VITE_CONTRACT_MESH_ORACLE'),
  // 11. ERC-7857 INFT token (the agent NFT itself)
  meshINFT:       addr('VITE_CONTRACT_MESH_INFT'),
  // 12. Cross-chain bridge adapter (0G <-> EVM chains)
  meshBridge:     addr('VITE_CONTRACT_MESH_BRIDGE'),
  // 13. Agent incentives & reward distributor
  meshIncentives: addr('VITE_CONTRACT_MESH_INCENTIVES'),
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
