import hre from "hardhat";
const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  const treasury = deployer.address;
  const zeroAddress = ethers.ZeroAddress;
  const zeroHash = ethers.ZeroHash;
  const teeSignerAddress = process.env.VITE_TEE_VERIFIER_ADDRESS || "0x4870CbC4D07d6Ac2EE5aA865588e5985FE77a4E9";

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
    nonce: initialNonce + 3
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
  const taskDagRegistry = await TaskDAGRegistry.deploy(bidEngineAddress, await meshEscrow.getAddress());
  await taskDagRegistry.waitForDeployment();
  console.log("TaskDAGRegistry deployed to:", await taskDagRegistry.getAddress());

  // Nonce N+3 (This must match the predicted BidEngine address!)
  const BidEngine = await ethers.getContractFactory("BidEngine");
  const bidEngine = await BidEngine.deploy(
    await agentRegistry.getAddress(),
    await taskDagRegistry.getAddress(),
    teeSignerAddress
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
    zeroHash // mrEnclave can be updated later
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
    1000  // 10% to treasury
  );
  await revenueRouter.waitForDeployment();
  console.log("RevenueRouter deployed to:", await revenueRouter.getAddress());
  
  await meshEscrow.setRevenueRouter(await revenueRouter.getAddress());
  await revenueRouter.setMeshEscrow(await meshEscrow.getAddress());

  console.log("\n--- Deploying System 2: Evolution Lab ---");

  // Deploy FitnessOracle 
  const FitnessOracle = await ethers.getContractFactory("FitnessOracle");
  const fitnessOracle = await FitnessOracle.deploy(teeSignerAddress, zeroHash);
  await fitnessOracle.waitForDeployment();
  console.log("FitnessOracle deployed to:", await fitnessOracle.getAddress());

  // Expected remaining nonces:
  // N+0: GenOps
  // N+1: ModelGenome
  // N+2: EvolutionClock
  // Predict EvolutionClock at N+2
  const currentNonce = await ethers.provider.getTransactionCount(deployer.address);
  const evoClockAddress = ethers.getCreateAddress({
    from: deployer.address,
    nonce: currentNonce + 2
  });

  // Deploy GenOps 
  const GenOps = await ethers.getContractFactory("GenOps");
  const genOps = await GenOps.deploy(
    evoClockAddress,
    treasury,
    ethers.parseEther("1"), // 1 OG breeding fee
    500 // 5% mutation rate
  );
  await genOps.waitForDeployment();
  console.log("GenOps deployed to:", await genOps.getAddress());

  // Deploy ModelGenome
  const ModelGenome = await ethers.getContractFactory("ModelGenome");
  const modelGenome = await ModelGenome.deploy(
    await fitnessOracle.getAddress(),
    await genOps.getAddress(),
    treasury
  );
  await modelGenome.waitForDeployment();
  console.log("ModelGenome (ERC-7857) deployed to:", await modelGenome.getAddress());

  // Fix circular dependency
  await fitnessOracle.setGenome(await modelGenome.getAddress());
  await genOps.setGenome(await modelGenome.getAddress());

  // Deploy EvolutionClock
  const EvolutionClock = await ethers.getContractFactory("EvolutionClock");
  const evolutionClock = await EvolutionClock.deploy(
    await genOps.getAddress(),
    100 // epoch length in blocks
  );
  await evolutionClock.waitForDeployment();
  console.log("EvolutionClock deployed to:", await evolutionClock.getAddress());
  
  if ((await evolutionClock.getAddress()) !== evoClockAddress) {
      console.error("CRITICAL ERROR: Predicted EvolutionClock address didn't match actual!");
      process.exit(1);
  }

  // Deploy InferencePool
  const InferencePool = await ethers.getContractFactory("InferencePool");
  const inferencePool = await InferencePool.deploy(await modelGenome.getAddress());
  await inferencePool.waitForDeployment();
  console.log("InferencePool deployed to:", await inferencePool.getAddress());

  // Deploy GenomeMarket
  const GenomeMarket = await ethers.getContractFactory("GenomeMarket");
  const genomeMarket = await GenomeMarket.deploy(await modelGenome.getAddress(), treasury);
  await genomeMarket.waitForDeployment();
  console.log("GenomeMarket deployed to:", await genomeMarket.getAddress());

  // Deploy GenomeDAO
  const GenomeDAO = await ethers.getContractFactory("GenomeDAO");
  const genomeDAO = await GenomeDAO.deploy(await modelGenome.getAddress());
  await genomeDAO.waitForDeployment();
  console.log("GenomeDAO deployed to:", await genomeDAO.getAddress());

  console.log("\n--- Deployment Complete! ---");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
