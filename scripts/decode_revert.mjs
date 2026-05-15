// Decode the revert reason for two failed transactions on 0G Chain
// by replaying them with viem's publicClient.call / simulateContract.

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

const targets = [
    {
        label: "AgentRegistry",
        hash: "0xcd61e3cba96419998785e42e77a1b6df34cec840a9e1c2537361d83f296b3774",
        abi: agentRegistryAbi,
    },
    {
        label: "TaskDAGRegistry",
        hash: "0xde24e9d1afa3fcff5ce0b1e36f0b302e8e482b2dacefb617b5d82dce80e8e4b6",
        abi: taskDagRegistryAbi,
    },
];

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

async function inspect({ label, hash, abi }) {
    console.log(`\n========== ${label} ==========`);
    console.log(`tx: ${hash}`);

    const tx = await client.getTransaction({ hash });
    const receipt = await client.getTransactionReceipt({ hash });

    console.log(`block:    ${tx.blockNumber}`);
    console.log(`from:     ${tx.from}`);
    console.log(`to:       ${tx.to}`);
    console.log(`value:    ${tx.value.toString()} wei`);
    console.log(`gasUsed:  ${receipt.gasUsed.toString()}`);
    console.log(`status:   ${receipt.status}`);

    let decoded;
    try {
        decoded = decodeFunctionData({ abi, data: tx.input });
        console.log(`func:     ${decoded.functionName}`);
        console.log(`args:     ${JSON.stringify(fmt(decoded.args), null, 2)}`);
    } catch (e) {
        console.log(`decode failed: ${e.message}`);
    }

    // Replay the call exactly as it was sent, at the block BEFORE the failed tx,
    // so we see what would have been the revert without other state changes
    // interfering.
    const replayBlock = tx.blockNumber - 1n;

    console.log(`\nReplaying via eth_call at block ${replayBlock}...`);
    try {
        await client.call({
            account: tx.from,
            to: tx.to,
            data: tx.input,
            value: tx.value,
            blockNumber: replayBlock,
        });
        console.log("eth_call returned successfully (no revert at pre-block — state changed in same block?)");
    } catch (err) {
        console.log("REVERT (pre-block):");
        console.log(`  name:        ${err.name}`);
        console.log(`  shortMessage:${err.shortMessage}`);
        if (err.details) console.log(`  details:     ${err.details}`);
        if (err.metaMessages) console.log(`  meta:        ${err.metaMessages.join(" | ")}`);
        if (err.cause?.data) console.log(`  raw data:    ${err.cause.data}`);
        if (err.cause?.reason) console.log(`  reason:      ${err.cause.reason}`);
    }

    // Also try at the exact block to capture state at the time of failure.
    console.log(`\nReplaying via eth_call at the exact failure block ${tx.blockNumber}...`);
    try {
        await client.call({
            account: tx.from,
            to: tx.to,
            data: tx.input,
            value: tx.value,
            blockNumber: tx.blockNumber,
        });
        console.log("eth_call returned successfully at failure block — odd.");
    } catch (err) {
        console.log("REVERT (failure block):");
        console.log(`  name:        ${err.name}`);
        console.log(`  shortMessage:${err.shortMessage}`);
        if (err.details) console.log(`  details:     ${err.details}`);
        if (err.metaMessages) console.log(`  meta:        ${err.metaMessages.join(" | ")}`);
        if (err.cause?.data) console.log(`  raw data:    ${err.cause.data}`);
        if (err.cause?.reason) console.log(`  reason:      ${err.cause.reason}`);
    }

    // Finally, run simulateContract with the decoded args for a clean readout.
    if (decoded) {
        console.log(`\nsimulateContract(${decoded.functionName}) at block ${replayBlock}...`);
        try {
            await client.simulateContract({
                account: tx.from,
                address: tx.to,
                abi,
                functionName: decoded.functionName,
                args: decoded.args,
                value: tx.value,
                blockNumber: replayBlock,
            });
            console.log("simulateContract succeeded — likely a same-block state collision (e.g., nonce reuse, double-register).");
        } catch (err) {
            console.log("SIMULATE REVERT:");
            console.log(`  name:        ${err.name}`);
            console.log(`  shortMessage:${err.shortMessage}`);
            if (err.details) console.log(`  details:     ${err.details}`);
            if (err.metaMessages) console.log(`  meta:        ${err.metaMessages.join(" | ")}`);
            if (err.cause?.data) console.log(`  raw data:    ${err.cause.data}`);
            if (err.cause?.reason) console.log(`  reason:      ${err.cause.reason}`);
        }
    }
}

for (const t of targets) {
    try {
        await inspect(t);
    } catch (e) {
        console.error(`\n[${t.label}] fatal:`, e);
    }
}
