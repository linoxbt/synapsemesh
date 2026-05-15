// Resubmit the failed DAG (tx 0xde24...e4b6) with the cycle removed.
//
// What the failed tx did:
//   - 2 nodes that depended on each other (cycle: A -> B and B -> A)
//   - Total budget: 0.2 OG (0.1 each)
//   - Sender: DEPLOYER_PRIVATE_KEY's address
//
// The fix: keep the same schema-hash commitments, drop the back-edge so we have
// a clean A -> B chain (B depends on A, A has no deps), and submit.

import "dotenv/config";
import {
    createPublicClient,
    createWalletClient,
    http,
    defineChain,
    keccak256,
    toHex,
    parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const RPC_URL = process.env.VITE_ZG_RPC_URL || "https://evmrpc.0g.ai";
const TASK_DAG_REGISTRY = process.env.VITE_CONTRACT_TASK_DAG_REGISTRY;
const PK = process.env.DEPLOYER_PRIVATE_KEY;

if (!TASK_DAG_REGISTRY) throw new Error("VITE_CONTRACT_TASK_DAG_REGISTRY missing");
if (!PK) throw new Error("DEPLOYER_PRIVATE_KEY missing");

const zeroG = defineChain({
    id: 16661,
    name: "0G Mainnet",
    nativeCurrency: { name: "OG", symbol: "OG", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
});

const account = privateKeyToAccount(PK.startsWith("0x") ? PK : `0x${PK}`);
const transport = http(RPC_URL);
const pub = createPublicClient({ chain: zeroG, transport });
const wallet = createWalletClient({ account, chain: zeroG, transport });

const abi = JSON.parse(
    fs.readFileSync(path.join(root, "artifacts", "contracts", "TaskDAGRegistry.sol", "TaskDAGRegistry.json"), "utf-8"),
).abi;

// Schema hashes preserved from the failed tx — these are the deployer's
// real commitments. A is the upstream (SEQUENTIAL), B is the downstream
// (CONDITIONAL) consumer of A's output. In the failed tx both pointed at
// each other; we drop A's dependency on B.
const NODE_A_HASHES = {
    inputSchemaHash:  "0x9f488d43e3666ebbb38c5b457bb7c97b9b4dc8429c4d9a2fbfd7aebdba8ad255",
    outputSchemaHash: "0x4156a306defd89628b088139139005b9ca308e6b0979ad57e8b338950db3348c",
    qualityRubricHash:"0x40d8770275e7be525a177f19e1d007efd7ae262298df5065537257907ea70350",
};
const NODE_B_HASHES = {
    inputSchemaHash:  "0xc43292d8262296e98df22d6b0ef8a0a02280c789b3d9de62a2e9d34a454329d2",
    outputSchemaHash: "0x04c92e9c8ca41d2ad9d175b73c968935efe8af12b1b1fee930b7e239c0b90559",
    qualityRubricHash:"0xad61d7363fb1ee030e58d635bab0043e5b85172ea0d1d7767addfa3e404773fa",
};

const dagRoot = keccak256(toHex(`resubmit-${Date.now()}-${account.address}`));
const taskIdA = keccak256(toHex(`${dagRoot}-NodeA`));
const taskIdB = keccak256(toHex(`${dagRoot}-NodeB`));

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const BUDGET_PER_NODE = parseEther("0.1");
const TOTAL_BUDGET = parseEther("0.2");

// Ordered so deps appear earlier — matches _validateNoCycles.
const taskNodes = [
    {
        taskId:           taskIdA,
        ...NODE_A_HASHES,
        dependsOn:        [],
        nodeType:         0,           // SEQUENTIAL
        maxBudget:        BUDGET_PER_NODE,
        timeoutBlocks:    100n,
        assignedAgent:    ZERO_ADDR,
        status:           0,
        assignedAt:       0n,
        completedAt:      0n,
    },
    {
        taskId:           taskIdB,
        ...NODE_B_HASHES,
        dependsOn:        [taskIdA],   // single forward edge — no cycle
        nodeType:         2,           // CONDITIONAL
        maxBudget:        BUDGET_PER_NODE,
        timeoutBlocks:    100n,
        assignedAgent:    ZERO_ADDR,
        status:           0,
        assignedAt:       0n,
        completedAt:      0n,
    },
];

console.log("Resubmitting DAG with cycle removed:");
console.log(`  from:     ${account.address}`);
console.log(`  to:       ${TASK_DAG_REGISTRY}`);
console.log(`  dagRoot:  ${dagRoot}`);
console.log(`  budget:   0.2 OG`);
console.log(`  nodes:    [A=${taskIdA.slice(0, 10)}…  -> B=${taskIdB.slice(0, 10)}…]`);

// Simulate first to catch any other revert before paying gas.
console.log("\n1/3 Simulating...");
const { request } = await pub.simulateContract({
    account,
    address: TASK_DAG_REGISTRY,
    abi,
    functionName: "submitDAG",
    args: [dagRoot, taskNodes],
    value: TOTAL_BUDGET,
});
console.log("    OK");

console.log("\n2/3 Sending tx...");
const hash = await wallet.writeContract(request);
console.log(`    tx: ${hash}`);
console.log(`    explorer: https://chainscan.0g.ai/tx/${hash}`);

console.log("\n3/3 Waiting for confirmation...");
const receipt = await pub.waitForTransactionReceipt({ hash });
console.log(`    block:   ${receipt.blockNumber}`);
console.log(`    status:  ${receipt.status}`);
console.log(`    gasUsed: ${receipt.gasUsed}`);

if (receipt.status !== "success") {
    console.error("\nDAG submit reverted on-chain. Re-check args.");
    process.exit(1);
}

console.log("\nDAG submitted successfully.");
console.log(`dagRoot: ${dagRoot}`);
