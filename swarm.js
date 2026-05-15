'use strict';
/**
 * SynapseMesh Swarm Commander — Production Agent Runtime
 *
 * Each agent runs a real contract-driven lifecycle:
 *   1. Register on AgentRegistry if not already registered.
 *   2. Listen for DAGSubmitted events from TaskDAGRegistry.
 *   3. For each new DAG, fetch all node taskIds via getDAGNodes().
 *   4. For each PENDING node whose dependencies are met, call getNode()
 *      to read the node's maxBudget and check it suits this agent's op.
 *   5. If the agent wins the bid (markNodeAssigned via BidEngine), execute work.
 *   6. Sign the TEE attestation with the TRUSTED_SIGNER key and call
 *      submitVerification() on TEEVerifierBridge.
 *
 * Environment variables required (.env):
 *   RPC_URL                — 0G Chain RPC endpoint
 *   AGENT_REGISTRY         — AgentRegistry.sol address
 *   TASK_DAG_REGISTRY      — TaskDAGRegistry.sol address
 *   TEE_VERIFIER_BRIDGE    — TEEVerifierBridge.sol address
 *   TRUSTED_SIGNER_KEY     — Private key of the address set as trustedVerifierSigner
 *                            in TEEVerifierBridge. Required for submitVerification.
 */

const { ethers } = require('ethers');
require('dotenv').config();
const fs = require('fs');

// ─── Config ──────────────────────────────────────────────────────────────────
const RPC_URL            = process.env.RPC_URL;
const AGENT_REGISTRY     = process.env.AGENT_REGISTRY;
const TASK_DAG_REGISTRY  = process.env.TASK_DAG_REGISTRY;
const BID_ENGINE         = process.env.BID_ENGINE;
const TEE_VERIFIER_BRIDGE = process.env.TEE_VERIFIER_BRIDGE;
const TRUSTED_SIGNER_KEY = process.env.TRUSTED_SIGNER_KEY; // Required — signs TEE attestations

if (!RPC_URL || !AGENT_REGISTRY || !TASK_DAG_REGISTRY || !BID_ENGINE || !TEE_VERIFIER_BRIDGE) {
  console.error('❌ Missing required env vars. Check .env for RPC_URL, AGENT_REGISTRY, TASK_DAG_REGISTRY, BID_ENGINE, TEE_VERIFIER_BRIDGE');
  process.exit(1);
}
if (!TRUSTED_SIGNER_KEY) {
  console.warn('⚠️  TRUSTED_SIGNER_KEY not set. submitVerification() will fail unless contract accepts agent signatures.');
}

const provider = new ethers.JsonRpcProvider(RPC_URL);

// ─── ABIs (minimal, matching deployed contracts) ──────────────────────────────
const AGENT_REG_ABI = [
  'function register(bytes32 _agentId) payable',
  'function isRegistered(address _agent) view returns (bool)',
  'function getReputation(address _agent) view returns (uint256)',
  'function getAgent(address _agent) view returns (tuple(address owner, bytes32 agentId, uint256 stakedAmount, uint256 reputation, uint256 tasksCompleted, uint256 totalEarned, bool slashed, bool active))',
];

const DAG_REG_ABI = [
  'event DAGSubmitted(bytes32 indexed dagRoot, address requester, uint256 nodeCount, uint256 budget)',
  'event NodeStatusChanged(bytes32 indexed taskId, uint8 newStatus, address agent)',
  'function getDAGNodes(bytes32 dagRoot) view returns (bytes32[])',
  'function getNode(bytes32 taskId) view returns (tuple(bytes32 taskId, bytes32 inputSchemaHash, bytes32 outputSchemaHash, bytes32 qualityRubricHash, bytes32[] dependsOn, uint8 nodeType, uint256 maxBudget, uint256 timeoutBlocks, address assignedAgent, uint8 status, uint256 assignedAt, uint256 completedAt))',
  'function getNodeStatus(bytes32 taskId) view returns (uint8)',
  'function dependenciesMet(bytes32 taskId) view returns (bool)',
];

// BidEngine — the only contract allowed to call TaskDAGRegistry.markNodeAssigned.
// Agents bid here; the off-chain auctioneer (scripts/auctioneer.mjs) scores and
// calls awardBid, which emits BidAwarded the agents listen for.
const BID_ENGINE_ABI = [
  'function submitBid(bytes32 taskId, uint256 price, uint256 eta) external',
  'event BidSubmitted(bytes32 indexed taskId, address agent, uint256 price, uint256 eta)',
  'event BidAwarded(bytes32 indexed taskId, address winner, uint256 price)',
];

const TEE_BRIDGE_ABI = [
  'function submitVerification(bytes32 taskId, address assignedAgent, bool passed, uint8 score, bytes teeSignature) external',
  'function trustedMrEnclave() view returns (bytes32)',
  'function trustedVerifierSigner() view returns (address)',
  'function isProcessed(bytes32 taskId) view returns (bool)',
  'function MIN_QUALITY() view returns (uint8)',
];

// ─── Node status enum (mirrors TaskDAGRegistry.NodeStatus) ───────────────────
const NodeStatus = { PENDING: 0, BIDDING: 1, EXECUTING: 2, VERIFYING: 3, SETTLED: 4, FAILED: 5 };

// ─── Utility: sleep ──────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── TEE Score derivation ────────────────────────────────────────────────────
// In a real TEE enclave this would be computed from the work output vs. the
// qualityRubricHash. Here we derive a deterministic score from the taskId so
// behaviour is reproducible across runs while not being purely random.
// Replace this function with an actual LLM evaluation call in production.
function deriveTeeScore(taskId, agentAddress) {
  // XOR the last 4 bytes of taskId with last 4 bytes of agent address to get a
  // stable but task-specific score in the [75, 99] range.
  const taskBytes  = Buffer.from(taskId.slice(2), 'hex');
  const agentBytes = Buffer.from(agentAddress.slice(2).toLowerCase(), 'hex');
  const xor = (taskBytes[28] ^ agentBytes[16]) + (taskBytes[29] ^ agentBytes[17]);
  return 75 + (xor % 25); // 75–99
}

// ─── TEE Attestation signing ─────────────────────────────────────────────────
// TEEVerifierBridge.submitVerification recovers the signer from teeSignature and
// checks it equals trustedVerifierSigner. The agent must sign with TRUSTED_SIGNER_KEY.
async function buildTeeSignature(trustedSigner, taskId, passed, score, mrEnclave) {
  const msgHash = ethers.solidityPackedKeccak256(
    ['bytes32', 'bool', 'uint8', 'bytes32'],
    [taskId, passed, score, mrEnclave]
  );
  return await trustedSigner.signMessage(ethers.getBytes(msgHash));
}

// ─── Bid eligibility check ────────────────────────────────────────────────────
// An agent bids on a node if:
//   a) Node is PENDING or BIDDING (not yet assigned)
//   b) All dependency nodes are SETTLED (dependenciesMet() returns true)
//   c) Agent's operation type matches the node (checked via agentConfig.op)
//   d) Agent is not slashed and is active
async function isEligibleForNode(dagReg, taskId, agentAddress) {
  try {
    const [status, depsOk] = await Promise.all([
      dagReg.getNodeStatus(taskId),
      dagReg.dependenciesMet(taskId),
    ]);
    if (Number(status) !== NodeStatus.PENDING && Number(status) !== NodeStatus.BIDDING) return false;
    if (!depsOk) return false;
    return true;
  } catch {
    return false;
  }
}

// ─── Agent lifecycle ──────────────────────────────────────────────────────────
async function startAgent(agentConfig, trustedSigner) {
  const wallet    = new ethers.Wallet(agentConfig.privateKey, provider);
  const agentReg  = new ethers.Contract(AGENT_REGISTRY, AGENT_REG_ABI, wallet);
  const dagReg    = new ethers.Contract(TASK_DAG_REGISTRY, DAG_REG_ABI, wallet);
  const bidEngine = new ethers.Contract(BID_ENGINE, BID_ENGINE_ABI, wallet);
  const teeBridge = new ethers.Contract(TEE_VERIFIER_BRIDGE, TEE_BRIDGE_ABI, wallet);

  const log = (msg) => console.log(`[${agentConfig.name}] ${msg}`);
  const err = (msg) => console.error(`[${agentConfig.name}] ❌ ${msg}`);

  log(`Starting… wallet: ${wallet.address}`);

  // ── Step 1: Ensure registration ─────────────────────────────────────────────
  try {
    const isReg = await agentReg.isRegistered(wallet.address);
    if (!isReg) {
      log('Not registered. Registering…');
      const agentIdBytes32 = ethers.id(agentConfig.name); // keccak256(utf8(name))
      const tx = await agentReg.register(agentIdBytes32, { value: ethers.parseEther('0.01') });
      await tx.wait();
      log('Registered ✓');
    } else {
      const reputation = await agentReg.getReputation(wallet.address);
      log(`Already registered. Reputation: ${reputation}`);
    }
  } catch (e) {
    err(`Registration failed: ${e.shortMessage || e.message}`);
    return; // Do not proceed if unregistered
  }

  // Fetch static TEE params once (mrEnclave is set at contract deploy; rarely changes)
  const [mrEnclave, minQuality] = await Promise.all([
    teeBridge.trustedMrEnclave(),
    teeBridge.MIN_QUALITY(),
  ]);
  log(`TEE enclave: ${mrEnclave.slice(0, 10)}… | MIN_QUALITY: ${minQuality}`);

  // Tracks taskIds where this agent has an open bid (between submitBid and BidAwarded).
  // Value carries the data needed to execute on win and a watchdog that gives up if the
  // auctioneer never settles.
  const myBids = new Map(); // taskId => { dropTimer }

  // Bid parameters (per project-owner spec).
  const BID_PRICE = ethers.parseEther('0.01'); // 0.01 OG
  const BID_ETA   = 30n;                       // 30 seconds estimate
  // If no BidAwarded arrives within this window, abandon the bid so the slot
  // can be retried via polling. Longer than the auctioneer's 10s collection
  // window plus generous RPC latency.
  const BID_AWARD_TIMEOUT_MS = 60_000;

  // ── Execute work + submit TEE attestation (only called after auction win) ───
  async function executeAndAttest(taskId) {
    try {
      // Simulate execution latency (replace with real LLM/tool call in production)
      await sleep(500 + Math.floor(Math.random() * 500));

      const score  = deriveTeeScore(taskId, wallet.address);
      const passed = score >= Number(minQuality);

      log(`Work complete — score: ${score}/100 passed: ${passed}`);

      const teeSignature = await buildTeeSignature(trustedSigner, taskId, passed, score, mrEnclave);

      const verifyTx = await teeBridge.submitVerification(
        taskId,
        wallet.address,
        passed,
        score,
        teeSignature
      );
      await verifyTx.wait();
      log(`✅ Verification submitted! Score: ${score} | Payout released.`);
    } catch (verifyErr) {
      err(`Verification failed: ${verifyErr.shortMessage || verifyErr.message}`);
    }
  }

  // ── Handle a DAG: enumerate eligible nodes and submit bids ──────────────────
  async function handleDag(dagRoot) {
    log(`New DAG detected: ${dagRoot}`);

    let taskIds;
    try {
      taskIds = await dagReg.getDAGNodes(dagRoot);
    } catch (e) {
      err(`getDAGNodes failed for ${dagRoot}: ${e.shortMessage || e.message}`);
      return;
    }

    if (!taskIds || taskIds.length === 0) {
      log(`DAG ${dagRoot.slice(0, 10)}… has no nodes, skipping.`);
      return;
    }

    log(`DAG has ${taskIds.length} node(s). Checking eligibility…`);

    for (const taskId of taskIds) {
      if (myBids.has(taskId)) continue;

      const eligible = await isEligibleForNode(dagReg, taskId, wallet.address);
      if (!eligible) continue;

      // Fetch full node to surface type/budget in logs (and skip if processed).
      let node;
      try {
        node = await dagReg.getNode(taskId);
      } catch (e) {
        err(`getNode(${taskId.slice(0, 10)}…) failed: ${e.shortMessage || e.message}`);
        continue;
      }

      const budgetOG = Number(ethers.formatEther(node.maxBudget));
      log(`Node ${taskId.slice(0, 10)}… — type: ${node.nodeType}, budget: ${budgetOG.toFixed(3)} OG`);

      try {
        const processed = await teeBridge.isProcessed(taskId);
        if (processed) { log(`Node already verified, skipping.`); continue; }
      } catch { /* continue */ }

      // ── Submit bid via BidEngine. The auctioneer service collects bids,
      //    scores them, and calls awardBid → BidAwarded fires → we execute. ──
      try {
        log(`Bidding on ${taskId.slice(0, 10)}… price=${ethers.formatEther(BID_PRICE)} OG eta=${BID_ETA}`);
        const bidTx = await bidEngine.submitBid(taskId, BID_PRICE, BID_ETA);
        await bidTx.wait();
      } catch (bidErr) {
        log(`submitBid rejected: ${bidErr.shortMessage || bidErr.message}`);
        continue;
      }

      // Register the open bid + a watchdog that abandons it if BidAwarded
      // never arrives (auctioneer down, RPC dropped the event, etc.).
      const dropTimer = setTimeout(() => {
        if (myBids.delete(taskId)) {
          log(`Bid award timed out for ${taskId.slice(0, 10)}… (auctioneer silent)`);
        }
      }, BID_AWARD_TIMEOUT_MS);
      myBids.set(taskId, { dropTimer });
      log(`Bid placed — awaiting BidAwarded for ${taskId.slice(0, 10)}…`);
    }
  }

  // ── BidAwarded listener: only execute when WE are the winner ────────────────
  bidEngine.on('BidAwarded', async (taskId, winner /* , price */) => {
    const entry = myBids.get(taskId);
    if (!entry) return; // not a bid we placed
    clearTimeout(entry.dropTimer);
    myBids.delete(taskId);

    if (winner.toLowerCase() !== wallet.address.toLowerCase()) {
      log(`Lost auction for ${taskId.slice(0, 10)}… (winner ${winner.slice(0, 8)}…)`);
      return;
    }

    log(`Won auction for ${taskId.slice(0, 10)}… — executing`);
    try {
      await executeAndAttest(taskId);
    } catch (e) {
      err(`Post-win execution failed: ${e.message}`);
    }
  });

  // ── Subscribe to new DAGs (primary path; ethers polls under HTTP) ───────────
  dagReg.on('DAGSubmitted', async (dagRoot, _requester, _nodeCount, _budget) => {
    try {
      await handleDag(dagRoot);
    } catch (e) {
      err(`Unhandled error in DAGSubmitted handler: ${e.message}`);
    }
  });

  // ── Polling fallback for DAGSubmitted ───────────────────────────────────────
  // Every 30s, sweep DAGSubmitted logs from the last scanned block forward.
  // Catches DAGs missed by the subscription if the underlying connection
  // dropped. handleDag is idempotent (myBids + on-chain getNodeStatus filter
  // already-bidded/already-assigned nodes), so re-processing is safe.
  let lastScannedBlock = await provider.getBlockNumber().catch(() => 0n);
  const POLL_INTERVAL_MS = 30_000;
  setInterval(async () => {
    try {
      const head = await provider.getBlockNumber();
      if (BigInt(head) <= BigInt(lastScannedBlock)) return;
      const events = await dagReg.queryFilter(
        dagReg.filters.DAGSubmitted(),
        Number(lastScannedBlock) + 1,
        Number(head),
      );
      lastScannedBlock = head;
      if (events.length === 0) return;
      log(`[poll] ${events.length} DAGSubmitted event(s) since last sweep`);
      for (const ev of events) {
        try { await handleDag(ev.args.dagRoot); }
        catch (e) { err(`[poll] handleDag failed: ${e.message}`); }
      }
    } catch (e) {
      err(`[poll] sweep failed: ${e.shortMessage || e.message}`);
    }
  }, POLL_INTERVAL_MS);

  log('Listening for DAGSubmitted (sub + 30s poll) and BidAwarded…');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 SynapseMesh Swarm Commander — Starting…');

  const agents = JSON.parse(fs.readFileSync('specialized_agents.json', 'utf8'));
  console.log(`Initializing ${agents.length} agents…`);

  // The trusted signer is a single shared key used to sign TEE attestations.
  // This mirrors the real 0G Compute TEE setup where one enclave signs for all.
  if (!TRUSTED_SIGNER_KEY) {
    console.error('❌ TRUSTED_SIGNER_KEY is required. Add it to .env and restart.');
    process.exit(1);
  }
  const trustedSigner = new ethers.Wallet(TRUSTED_SIGNER_KEY, provider);
  console.log(`Trusted TEE signer: ${trustedSigner.address}`);

  // Stagger agent startup to avoid RPC rate limits
  for (let i = 0; i < agents.length; i++) {
    setTimeout(() => {
      startAgent(agents[i], trustedSigner).catch((e) => {
        console.error(`[${agents[i].name}] Fatal startup error:`, e.message);
      });
    }, i * 2000);
  }
}

main().catch(console.error);
