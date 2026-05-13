const fs = require('fs');

const DGRID_API_KEY = 'sk-718dd41ca86b4957b513a93c671ca8ff'; // Your provided dgrid API key
const DOCKER_IMAGE = 'linoxbt/synapsemesh-agent:latest'; // Replace with your actual DockerHub username

// The dGrid API endpoint for 0G Compute TEE deployments
const DGRID_API_URL = 'https://api.dgrid.0g.ai/v1/deploy';

async function deployToTEE() {
    console.log("🚀 Starting SynapseMesh TEE Deployment...");
    console.log(`📦 Target Image: ${DOCKER_IMAGE}`);
    
    try {
        console.log("🔗 Connecting to dGrid API...");
        
        // Example payload to deploy 14 containers (2 per role) to Intel SGX enabled instances
        const payload = {
            image: DOCKER_IMAGE,
            replicas: 14,
            hardware: "intel-sgx",
            network: "0g-newton-mainnet",
            env: {
                RPC_URL: process.env.VITE_MAINNET_RPC || "https://rpc-mainnet.0g.ai",
                MESH_ESCROW: process.env.VITE_CONTRACT_MESH_ESCROW,
                AGENT_REGISTRY: process.env.VITE_CONTRACT_AGENT_REGISTRY,
                TASK_DAG_REGISTRY: process.env.VITE_CONTRACT_TASK_DAG_REGISTRY,
                TEE_VERIFIER_BRIDGE: process.env.VITE_CONTRACT_TEE_VERIFIER_BRIDGE,
            }
        };

        const response = await fetch(DGRID_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DGRID_API_KEY}`
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`dGrid API Error (${response.status}): ${err}`);
        }

        const data = await response.json();
        console.log("✅ Successfully deployed to 0G Compute TEE!");
        console.log(`🌐 Deployment ID: ${data.deploymentId}`);
        console.log(`💻 TEE Endpoints: \n`, data.endpoints);

    } catch (error) {
        console.error("❌ Deployment failed:");
        console.error(error.message);
        console.log("\n💡 Make sure you have built and pushed the image first:");
        console.log("1. docker build -t " + DOCKER_IMAGE + " .");
        console.log("2. docker push " + DOCKER_IMAGE);
    }
}

deployToTEE();
