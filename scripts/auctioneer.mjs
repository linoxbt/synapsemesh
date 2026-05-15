// SynapseMesh Auctioneer — off-chain bid scorer.
//
// Architecture
//   - Subscribes (via polling) to BidEngine.BidSubmitted on 0G Mainnet.
//   - Buckets bids by taskId. On the first bid seen for a taskId, starts a
//     10-second collection window. When the window fires, re-reads bids from
//     the contract (canonical source — events may be slightly behind), scores
//     each one, and calls BidEngine.awardBid(taskId, winner) as AUCTIONEER_PRIVATE_KEY.
//   - Scoring (per project-owner spec):
//        score = (rep * 0.5) + (1/price * 0.3) + (1/eta * 0.2)
//     `rep = 1` for every agent in this version (will be wired to live
//     reputation later).
//
// Env vars (.env)
//   RPC_URL                  0G mainnet RPC                 (or falls back to VITE_ZG_RPC_URL)
//   BID_ENGINE               BidEngine contract address     (or falls back to VITE_CONTRACT_BID_ENGINE)
//   AUCTIONEER_PRIVATE_KEY   Signs awardBid; must equal BidEngine.auctioneer()

import "dotenv/config";
import {
    createPublicClient,
    createWalletClient,
    http,
    defineChain,
    parseAbiItem,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC_URL = process.env.RPC_URL || process.env.VITE_ZG_RPC_URL || "https://evmrpc.0g.ai";
const BID_ENGINE = process.env.BID_ENGINE || process.env.VITE_CONTRACT_BID_ENGINE;
const AUCTIONEER_PRIVATE_KEY = process.env.AUCTIONEER_PRIVATE_KEY;

if (!BID_ENGINE) {
    console.error("BID_ENGINE not set (and VITE_CONTRACT_BID_ENGINE not in env).");
    process.exit(1);
}
if (!AUCTIONEER_PRIVATE_KEY) {
    console.error("AUCTIONEER_PRIVATE_KEY not set. Add it to .env.");
    process.exit(1);
}

const COLLECTION_WINDOW_MS = 10_000;
const POLL_INTERVAL_MS = 4_000;
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

const zgMainnet = defineChain({
    id: 16661,
    name: "0G Aristotle Mainnet",
    nativeCurrency: { name: "0G", symbol: "OG", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
    contracts: { multicall3: { address: MULTICALL3 } },
});

const pkHex = AUCTIONEER_PRIVATE_KEY.startsWith("0x")
    ? AUCTIONEER_PRIVATE_KEY
    : `0x${AUCTIONEER_PRIVATE_KEY}`;
const account = privateKeyToAccount(pkHex);

const pub = createPublicClient({ chain: zgMainnet, transport: http(RPC_URL) });
const wallet = createWalletClient({ account, chain: zgMainnet, transport: http(RPC_URL) });

// ABI fragments — only what the auctioneer touches.
const BID_SUBMITTED_EVENT = parseAbiItem(
    "event BidSubmitted(bytes32 indexed taskId, address agent, uint256 price, uint256 eta)",
);
const BID_AWARDED_EVENT = parseAbiItem(
    "event BidAwarded(bytes32 indexed taskId, address winner, uint256 price)",
);
const AWARD_BID_FN = parseAbiItem("function awardBid(bytes32 taskId, address winnerAgent) external");
const GET_BIDS_FN = parseAbiItem(
    "function getBids(bytes32 taskId) view returns ((address agent, uint256 price, uint256 eta, uint256 reputation, uint256 submittedAt)[])",
);
const AWARDED_FN = parseAbiItem("function awarded(bytes32) view returns (bool)");
const AUCTIONEER_FN = parseAbiItem("function auctioneer() view returns (address)");

const READ_ABI = [GET_BIDS_FN, AWARDED_FN, AUCTIONEER_FN];
const WRITE_ABI = [AWARD_BID_FN];

// taskId (hex string) => { timer, firstSeen }
const pending = new Map();

// ─── Startup sanity: signer must match BidEngine.auctioneer() ────────────────
const onchainAuctioneer = await pub.readContract({
    address: BID_ENGINE,
    abi: READ_ABI,
    functionName: "auctioneer",
});
console.log(`[auctioneer] signer:          ${account.address}`);
console.log(`[auctioneer] BidEngine:       ${BID_ENGINE}`);
console.log(`[auctioneer] onchain auctioneer: ${onchainAuctioneer}`);
if (onchainAuctioneer.toLowerCase() !== account.address.toLowerCase()) {
    console.error(
        `[auctioneer] FATAL: signer ${account.address} is not the contract's auctioneer ` +
        `(${onchainAuctioneer}). awardBid will revert with "only auctioneer".`,
    );
    process.exit(1);
}

// ─── Score a single bid per project-owner spec ───────────────────────────────
function scoreBid(bid) {
    const rep = 1; // flat for all agents in v1; will be wired to actual reputation later
    const price = Number(bid.price);
    const eta = Number(bid.eta);
    if (price <= 0 || eta <= 0) return -Infinity;
    return rep * 0.5 + (1 / price) * 0.3 + (1 / eta) * 0.2;
}

// ─── Settle a single task: read bids, pick winner, send awardBid ─────────────
async function settle(taskId) {
    pending.delete(taskId);

    // Re-check on-chain that this task wasn't already awarded (the agent's bid
    // could have raced with another auctioneer run, or be a re-org artifact).
    try {
        const already = await pub.readContract({
            address: BID_ENGINE,
            abi: READ_ABI,
            functionName: "awarded",
            args: [taskId],
        });
        if (already) {
            console.log(`[auctioneer] ${taskId.slice(0, 10)}… already awarded — skipping`);
            return;
        }
    } catch (e) {
        console.error(`[auctioneer] awarded() read failed for ${taskId.slice(0, 10)}…: ${e.shortMessage || e.message}`);
    }

    let bids;
    try {
        bids = await pub.readContract({
            address: BID_ENGINE,
            abi: READ_ABI,
            functionName: "getBids",
            args: [taskId],
        });
    } catch (e) {
        console.error(`[auctioneer] getBids() failed for ${taskId.slice(0, 10)}…: ${e.shortMessage || e.message}`);
        return;
    }

    if (!bids || bids.length === 0) {
        console.log(`[auctioneer] no bids on-chain for ${taskId.slice(0, 10)}…`);
        return;
    }

    let bestScore = -Infinity;
    let winner = null;
    for (const b of bids) {
        const s = scoreBid(b);
        if (s > bestScore) {
            bestScore = s;
            winner = b.agent;
        }
    }

    if (!winner || bestScore === -Infinity) {
        console.log(`[auctioneer] no valid bid for ${taskId.slice(0, 10)}…`);
        return;
    }

    console.log(
        `[auctioneer] ${taskId.slice(0, 10)}…  bids=${bids.length}  winner=${winner}  score=${bestScore.toExponential(3)}`,
    );

    try {
        const hash = await wallet.writeContract({
            address: BID_ENGINE,
            abi: WRITE_ABI,
            functionName: "awardBid",
            args: [taskId, winner],
        });
        const receipt = await pub.waitForTransactionReceipt({ hash });
        console.log(
            `[auctioneer] awardBid ${taskId.slice(0, 10)}… -> ${winner}  tx=${hash}  block=${receipt.blockNumber}  status=${receipt.status}`,
        );
    } catch (e) {
        console.error(`[auctioneer] awardBid failed for ${taskId.slice(0, 10)}…: ${e.shortMessage || e.message}`);
    }
}

// ─── Event watcher (HTTP polling under viem) ─────────────────────────────────
function startWatching() {
    pub.watchContractEvent({
        address: BID_ENGINE,
        abi: [BID_SUBMITTED_EVENT],
        eventName: "BidSubmitted",
        pollingInterval: POLL_INTERVAL_MS,
        onLogs: (logs) => {
            for (const log of logs) {
                const { taskId, agent, price, eta } = log.args;
                console.log(
                    `[auctioneer] BidSubmitted  task=${taskId.slice(0, 10)}…  agent=${agent.slice(0, 8)}…  price=${price}  eta=${eta}`,
                );
                if (!pending.has(taskId)) {
                    const timer = setTimeout(() => settle(taskId), COLLECTION_WINDOW_MS);
                    pending.set(taskId, { timer, firstSeen: Date.now() });
                }
            }
        },
        onError: (e) => {
            console.error(`[auctioneer] watch error: ${e.shortMessage || e.message}`);
        },
    });

    // Also surface BidAwarded so we can see our own awards land + catch any
    // races where another auctioneer instance awarded first.
    pub.watchContractEvent({
        address: BID_ENGINE,
        abi: [BID_AWARDED_EVENT],
        eventName: "BidAwarded",
        pollingInterval: POLL_INTERVAL_MS,
        onLogs: (logs) => {
            for (const log of logs) {
                const { taskId, winner } = log.args;
                console.log(`[auctioneer] BidAwarded   task=${taskId.slice(0, 10)}…  winner=${winner}`);
                // If we had a pending settlement for this task, cancel it.
                const entry = pending.get(taskId);
                if (entry) {
                    clearTimeout(entry.timer);
                    pending.delete(taskId);
                }
            }
        },
    });
}

startWatching();
console.log(`[auctioneer] watching BidSubmitted on ${BID_ENGINE} (poll ${POLL_INTERVAL_MS}ms, window ${COLLECTION_WINDOW_MS}ms)`);

// Keep the process alive even if all event watchers are paused.
process.stdin.resume();
process.on("SIGINT", () => { console.log("\n[auctioneer] shutting down"); process.exit(0); });
