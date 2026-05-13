const { ethers } = require('ethers');
require('dotenv').config();
const fs = require('fs');

const RPC_URL = process.env.RPC_URL;
const MESH_ESCROW = process.env.MESH_ESCROW;
const AGENT_REGISTRY = process.env.AGENT_REGISTRY;
const TASK_DAG_REGISTRY = process.env.TASK_DAG_REGISTRY;
const TEE_VERIFIER_BRIDGE = process.env.TEE_VERIFIER_BRIDGE;

const provider = new ethers.JsonRpcProvider(RPC_URL);

// Minified ABIs
const AGENT_REG_ABI = ['function register(bytes32 _agentId) payable', 'function isRegistered(address _agent) view returns (bool)'];
const DAG_REG_ABI = ['event DAGSubmitted(bytes32 indexed dagRoot, address requester, uint256 nodeCount, uint256 budget)', 'function getNode(bytes32 taskId) view returns (tuple(bytes32 taskId, bytes32 inputSchemaHash, bytes32 outputSchemaHash, bytes32 qualityRubricHash, bytes32[] dependsOn, uint8 nodeType, uint256 maxBudget, uint256 timeoutBlocks, address assignedAgent, uint8 status, uint256 assignedAt, uint256 completedAt))'];
const TEE_BRIDGE_ABI = ['function submitVerification(bytes32 taskId, address assignedAgent, bool passed, uint8 score, bytes teeSignature) external', 'function trustedMrEnclave() view returns (bytes32)'];

async function startAgent(agentConfig) {
    const wallet = new ethers.Wallet(agentConfig.privateKey, provider);
    const agentReg = new ethers.Contract(AGENT_REGISTRY, AGENT_REG_ABI, wallet);
    const dagReg = new ethers.Contract(TASK_DAG_REGISTRY, DAG_REG_ABI, wallet);
    const teeBridge = new ethers.Contract(TEE_VERIFIER_BRIDGE, TEE_BRIDGE_ABI, wallet);

    console.log(`[${agentConfig.name}] Starting... (Address: ${wallet.address})`);

    // 1. Check Registration
    try {
        const isReg = await agentReg.isRegistered(wallet.address);
        if (!isReg) {
            console.log(`[${agentConfig.name}] Registering...`);
            const tx = await agentReg.register(ethers.id(agentConfig.name), { value: ethers.parseEther('0.01') });
            await tx.wait();
            console.log(`[${agentConfig.name}] Registered successfully!`);
        } else {
            console.log(`[${agentConfig.name}] Already registered.`);
        }
    } catch (e) {
        console.error(`[${agentConfig.name}] Registration error:`, e.message);
    }

    // 2. Listen for DAGs
    dagReg.on('DAGSubmitted', async (dagRoot, requester, nodeCount, budget, event) => {
        console.log(`[${agentConfig.name}] Noticed new DAG:`, dagRoot);
        
        // Simulating matching operation type. For demo, we just randomly pick it up if it matches our "op"
        // Since the on-chain event doesn't emit the full DAG nodes yet, we'll pretend the agent inspects 0G Storage
        // and decides if it's the right fit.
        
        // 30% chance to claim it to simulate multiple agents competing
        if (Math.random() > 0.3) {
            return;
        }

        const taskId = dagRoot; 
        console.log(`[${agentConfig.name}] Picked up task:`, taskId);
        
        const score = 85 + Math.floor(Math.random() * 15); // 85 to 99
        const passed = true;
        
        try {
            const mrEnclave = await teeBridge.trustedMrEnclave();
            const msgHash = ethers.solidityPackedKeccak256(
                ['bytes32', 'bool', 'uint8', 'bytes32'],
                [taskId, passed, score, mrEnclave]
            );
            const signature = await wallet.signMessage(ethers.getBytes(msgHash));

            console.log(`[${agentConfig.name}] Submitting TEE verification...`);
            const tx = await teeBridge.submitVerification(taskId, wallet.address, passed, score, signature);
            await tx.wait();
            console.log(`[${agentConfig.name}] ✅ Verified! Score: ${score}. Payout released.`);
        } catch (err) {
            console.error(`[${agentConfig.name}] Failed verification:`, err.shortMessage || err.message);
        }
    });
}

async function main() {
    console.log('🚀 SynapseMesh Swarm Commander Starting...');
    const agents = JSON.parse(fs.readFileSync('specialized_agents.json', 'utf8'));
    
    console.log(`Initializing ${agents.length} specialized agents...`);
    
    // Start them all concurrently but staggered to avoid rate limits
    for (let i = 0; i < agents.length; i++) {
        setTimeout(() => {
            startAgent(agents[i]);
        }, i * 2000); // start 1 every 2 seconds
    }
}

main().catch(console.error);
