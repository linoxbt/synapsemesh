// Re-simulate at the latest block (the 0G RPC has pruned historical state,
// so calls against earlier blocks fail with "missing trie node"). The reverts
// we care about are deterministic given inputs (pure cycle check, etc.), so
// simulating at HEAD will still surface the right revert string.

import { createPublicClient, http, decodeFunctionData, defineChain } from "viem";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const RPC_URL = process.env.VITE_ZG_RPC_URL || "https://evmrpc.0g.ai";

const zeroG = defineChain({
    id: 16661,
    name: "0G Mainnet",
    nativeCurrency: { name: "OG", symbol: "OG", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
});

const client = createPublicClient({ chain: zeroG, transport: http(RPC_URL) });

function loadAbi(name) {
    const p = path.join(root, "artifacts", "contracts", `${name}.sol`, `${name}.json`);
    return JSON.parse(fs.readFileSync(p, "utf-8")).abi;
}

const agentRegistryAbi = loadAbi("AgentRegistry");
const taskDagRegistryAbi = loadAbi("TaskDAGRegistry");

function fmt(v) {
    if (typeof v === "bigint") return v.toString();
    if (Array.isArray(v)) return v.map(fmt);
    if (v && typeof v === "object") {
        const out = {};
        for (const k of Object.keys(v)) out[k] = fmt(v[k]);
        return out;
    }
    return v;
}

function printRevert(err) {
    console.log(`  name:         ${err.name}`);
    console.log(`  shortMessage: ${err.shortMessage}`);
    if (err.cause?.reason) console.log(`  reason:       ${err.cause.reason}`);
    if (err.cause?.data) console.log(`  raw data:     ${err.cause.data}`);
    // Walk inside for the actual contract revert string if viem buried it
    let inner = err;
    for (let i = 0; i < 6 && inner; i++) {
        if (inner.reason) {
            console.log(`  inner.reason: ${inner.reason}`);
            break;
        }
        inner = inner.cause;
    }
}

async function tryFetch(label, hash, fallbackRpcs = []) {
    const rpcsToTry = [RPC_URL, ...fallbackRpcs];
    for (const rpc of rpcsToTry) {
        try {
            const c = createPublicClient({ chain: zeroG, transport: http(rpc) });
            const tx = await c.getTransaction({ hash });
            const receipt = await c.getTransactionReceipt({ hash });
            console.log(`[${label}] found via ${rpc}`);
            return { tx, receipt, client: c };
        } catch (e) {
            console.log(`[${label}] not on ${rpc}: ${e.shortMessage || e.message}`);
        }
    }
    return null;
}

// ─────────────────────────────────────────────────────────────
// AgentRegistry
// ─────────────────────────────────────────────────────────────
console.log("\n========== AgentRegistry ==========");
const agentRegistryAddr = "0x8CDe1A5e466712b133099dCBc3bBFF835eAfBe4d";
const agentHash = "0xcd61e3cba96419998785e42e77a1b6df34cec840a9e1c2537361d83f296b3774";

// 0G has multiple public RPCs — try a couple
const result = await tryFetch("AgentRegistry", agentHash, [
    "https://0g-evmrpc-mainnet.zer0node.com",
    "https://0g-rpc.bonynode.online",
    "https://rpc.ankr.com/0g_mainnet",
]);

if (!result) {
    console.log("Transaction not found on any tried RPC. It was likely either:");
    console.log("  - dropped from the mempool before inclusion (never mined)");
    console.log("  - replaced by a same-nonce tx with higher gas (cancel / speed-up)");
    console.log("  - mined to a different chain than 0G mainnet");
    console.log("→ Without the on-chain tx we can't decode the original calldata, but");
    console.log("  we can audit AgentRegistry.register() requires:");
    console.log("    1) !registered[msg.sender]            -> 'already registered'");
    console.log("    2) msg.value >= MIN_STAKE (100 OG)    -> 'stake too low'");
    console.log("    3) agentIdToOwner[_agentId] == 0      -> 'agentId taken'");

    // Read current state from contract to spot which one is the live blocker for the deployer
    const deployer = "0x4631a836cad8148f7b02bb8f4ceed00f02ee88df";
    try {
        const reg = await client.readContract({
            address: agentRegistryAddr,
            abi: agentRegistryAbi,
            functionName: "registered",
            args: [deployer],
        });
        const minStake = await client.readContract({
            address: agentRegistryAddr,
            abi: agentRegistryAbi,
            functionName: "MIN_STAKE",
        });
        console.log(`\nCurrent state on ${agentRegistryAddr}:`);
        console.log(`  registered[${deployer}] = ${reg}`);
        console.log(`  MIN_STAKE = ${minStake.toString()} wei (${Number(minStake) / 1e18} OG)`);
    } catch (e) {
        console.log(`Live state read failed: ${e.shortMessage || e.message}`);
    }
}

// ─────────────────────────────────────────────────────────────
// TaskDAGRegistry — re-simulate at latest, cycle check is pure
// ─────────────────────────────────────────────────────────────
console.log("\n========== TaskDAGRegistry ==========");
const taskHash = "0xde24e9d1afa3fcff5ce0b1e36f0b302e8e482b2dacefb617b5d82dce80e8e4b6";
const tx = await client.getTransaction({ hash: taskHash });

const decoded = decodeFunctionData({ abi: taskDagRegistryAbi, data: tx.input });
console.log(`func: ${decoded.functionName}`);

const [dagRoot, taskNodes] = decoded.args;
console.log(`\nDecoded ${taskNodes.length} task nodes:`);
for (let i = 0; i < taskNodes.length; i++) {
    const n = taskNodes[i];
    console.log(`  [${i}] taskId=${n.taskId}`);
    console.log(`       dependsOn=${JSON.stringify(n.dependsOn)}`);
    console.log(`       maxBudget=${n.maxBudget.toString()} wei`);
}

// Static cycle/order check (matches contract logic)
console.log("\nStatic cycle/order analysis (mirrors _validateNoCycles):");
let cycleFound = false;
for (let i = 0; i < taskNodes.length; i++) {
    for (const dep of taskNodes[i].dependsOn) {
        let earlier = false;
        for (let k = 0; k < i; k++) {
            if (taskNodes[k].taskId === dep) { earlier = true; break; }
        }
        if (!earlier) {
            console.log(`  node[${i}] (${taskNodes[i].taskId}) depends on ${dep}`);
            console.log(`       -> NOT FOUND in nodes[0..${i - 1}]  =>  contract reverts with`);
            console.log(`       -> "DAGRegistry: cycle detected or bad dependency"`);
            cycleFound = true;
        }
    }
}
if (!cycleFound) console.log("  No ordering/cycle issue detected statically.");

console.log("\nRe-simulating at the LATEST block (pre-block trie is pruned)...");
try {
    await client.simulateContract({
        account: tx.from,
        address: tx.to,
        abi: taskDagRegistryAbi,
        functionName: "submitDAG",
        args: decoded.args,
        value: tx.value,
    });
    console.log("simulateContract succeeded — would not have reverted at HEAD.");
} catch (err) {
    console.log("simulateContract REVERT:");
    printRevert(err);
}
