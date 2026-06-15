import hre from "hardhat";
const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  const treasury = deployer.address;
  const zeroAddress = ethers.ZeroAddress;
  const zeroHash = ethers.ZeroHash;
  const teeSignerAddress =
    process.env.VITE_TEE_VERIFIER_ADDRESS || "0x4870CbC4D07d6Ac2EE5aA865588e5985FE77a4E9";

  const initialNonce = await ethers.provider.getTransactionCount(deployer.address);
  console.log("Starting nonce:", initialNonce);

  // Expected nonces (assuming no other transactions occur during this script):
  // N+0: MeshEscrow
  // N+1: AgentRegistry
  // N+2: TaskDAGRegistry
  // N+3: TEEVerifierBridge
  // N+4: BidEngine
  // Wait, TEEVerifierBridge depends on TaskDAGRegistry. BidEngine depends on TaskDAGRegistry.
  // We can deploy BidEngine at N+3 and TEEVerifierBridge at N+4!

  // Predict BidEngine address: (it will be deployed at nonce N+3)
  const bidEngineAddress = ethers.getCreateAddress({
    from: deployer.address,
    nonce: initialNonce + 3,
  });
  console.log("Predicted BidEngine address:", bidEngineAddress);

  console.log("\n--- Deploying System 1: Task Economy ---");

  // Nonce N+0
  const MeshEscrow = await ethers.getContractFactory("MeshEscrow");
  const meshEscrow = await MeshEscrow.deploy();
  await meshEscrow.waitForDeployment();
  console.log("MeshEscrow deployed to:", await meshEscrow.getAddress());

  // Nonce N+1
  const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
  const agentRegistry = await AgentRegistry.deploy(await meshEscrow.getAddress(), treasury);
  await agentRegistry.waitForDeployment();
  console.log("AgentRegistry deployed to:", await agentRegistry.getAddress());

  // Nonce N+2 (Takes BidEngine address and MeshEscrow address)
  const TaskDAGRegistry = await ethers.getContractFactory("TaskDAGRegistry");
  const taskDagRegistry = await TaskDAGRegistry.deploy(
    bidEngineAddress,
    await meshEscrow.getAddress(),
  );
  await taskDagRegistry.waitForDeployment();
  console.log("TaskDAGRegistry deployed to:", await taskDagRegistry.getAddress());

  // Nonce N+3 (This must match the predicted BidEngine address!)
  const BidEngine = await ethers.getContractFactory("BidEngine");
  const bidEngine = await BidEngine.deploy(
    await agentRegistry.getAddress(),
    await taskDagRegistry.getAddress(),
    teeSignerAddress,
  );
  await bidEngine.waitForDeployment();
  console.log("BidEngine deployed to:", await bidEngine.getAddress());

  if ((await bidEngine.getAddress()) !== bidEngineAddress) {
    console.error("CRITICAL ERROR: Predicted BidEngine address didn't match actual!");
    process.exit(1);
  }

  // Nonce N+4
  const TEEVerifierBridge = await ethers.getContractFactory("TEEVerifierBridge");
  const teeVerifier = await TEEVerifierBridge.deploy(
    await meshEscrow.getAddress(),
    await agentRegistry.getAddress(),
    await taskDagRegistry.getAddress(),
    teeSignerAddress,
    zeroHash, // mrEnclave can be updated later
  );
  await teeVerifier.waitForDeployment();
  console.log("TEEVerifierBridge deployed to:", await teeVerifier.getAddress());

  // Admin Setters
  await agentRegistry.setTeeVerifier(await teeVerifier.getAddress());
  await meshEscrow.setDagRegistry(await taskDagRegistry.getAddress());
  await meshEscrow.setTeeVerifier(await teeVerifier.getAddress());
  await taskDagRegistry.setTeeVerifier(await teeVerifier.getAddress());

  // Nonce N+9 (approximately, after setters)
  const RevenueRouter = await ethers.getContractFactory("RevenueRouter");
  const revenueRouter = await RevenueRouter.deploy(
    treasury,
    8000, // 80% to agent
    1000, // 10% to stakers
    1000, // 10% to treasury
  );
  await revenueRouter.waitForDeployment();
  console.log("RevenueRouter deployed to:", await revenueRouter.getAddress());

  await meshEscrow.setRevenueRouter(await revenueRouter.getAddress());
  await revenueRouter.setMeshEscrow(await meshEscrow.getAddress());

  console.log("\n--- Deployment Complete! ---");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
