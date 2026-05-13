import hre from "hardhat";

async function verifyContract(name: string, address: string, constructorArguments: any[]) {
    console.log(`\nVerifying ${name} at ${address}...`);
    try {
        await hre.run("verify:verify", {
            address,
            constructorArguments,
        });
        console.log(`✅ ${name} verified successfully.`);
    } catch (e: any) {
        if (e.message.toLowerCase().includes("already verified")) {
            console.log(`✅ ${name} is already verified.`);
        } else {
            console.error(`❌ Failed to verify ${name}: ${e.message}`);
        }
    }
}

async function main() {
    const treasury = "0x4631A836cAd8148F7B02bB8f4CeEd00f02EE88DF"; // deployer address used
    const zeroAddress = hre.ethers.ZeroAddress;
    const zeroHash = hre.ethers.ZeroHash;
    const teeSignerAddress = process.env.VITE_TEE_VERIFIER_ADDRESS || "0x4870CbC4D07d6Ac2EE5aA865588e5985FE77a4E9";

    // System 1 addresses (Run 2)
    const meshEscrow = "0x7B9421fF6588472b9f16D18c850017c942E3Df2e";
    const agentRegistry = "0x8CDe1A5e466712b133099dCBc3bBFF835eAfBe4d";
    const taskDagRegistry = "0x78C08B5d9d72dd3B404eb43EdDEE0f9366d0E812";
    const bidEngine = "0x372Fc8c3149Da1Bf2a8eF2415867449Cd10f6209";
    const teeVerifier = "0x4d0DC0C2F32edfD234B8c179e77721bEBF1611cF";
    const revenueRouter = "0xa1313d218EbA5E0970A86C7140233976892631a5";

    // System 2 addresses (Run 3)
    const fitnessOracle = "0x8313B473b8C9CaDcb56D4b5843A9BF61f7Beedd5";
    const genOps = "0x7cB119F6Dd19f1d882ab0F161BE95fC6Eeb38Ceb";
    const modelGenome = "0x50B7c1301CC7Da2EAd16375301e8977F0c1Ff793";
    const evoClock = "0xB53F9cE714A679775470147DA1d1BdD3a7b47DDd";

    // System 2 Final addresses (Run 4)
    const inferencePool = "0x991ff5dDabb0f6B9324f03ad151055D991D64082";
    const genomeMarket = "0xFc4303b75952530bb9ee9fe8DBE31C052a9b0045";
    const genomeDAO = "0x6535940F5ac91B0DB3cf9aE0B2efAA096bc973be";

    console.log("--- System 1: Task Economy ---");
    await verifyContract("MeshEscrow", meshEscrow, []);
    await verifyContract("AgentRegistry", agentRegistry, [meshEscrow, treasury]);
    await verifyContract("TaskDAGRegistry", taskDagRegistry, [bidEngine, meshEscrow]);
    await verifyContract("BidEngine", bidEngine, [agentRegistry, taskDagRegistry, teeSignerAddress]);
    await verifyContract("TEEVerifierBridge", teeVerifier, [meshEscrow, agentRegistry, taskDagRegistry, teeSignerAddress, zeroHash]);
    await verifyContract("RevenueRouter", revenueRouter, [treasury, 8000, 1000, 1000]);

    console.log("\n--- System 2: Evolution Lab ---");
    await verifyContract("FitnessOracle", fitnessOracle, [teeSignerAddress, zeroHash]);
    await verifyContract("GenOps", genOps, [evoClock, treasury, hre.ethers.parseEther("1"), 500]);
    await verifyContract("ModelGenome", modelGenome, [fitnessOracle, genOps, treasury]);
    await verifyContract("EvolutionClock", evoClock, [genOps, 100]);
    await verifyContract("InferencePool", inferencePool, [modelGenome, treasury, 1000]);
    await verifyContract("GenomeMarket", genomeMarket, [modelGenome, treasury, 250]);
    await verifyContract("GenomeDAO", genomeDAO, [modelGenome, evoClock, genOps, 1000, 3]);

    console.log("\nVerification Process Completed!");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
