import hre from "hardhat";
const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying System 2 with the account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  const treasury = deployer.address;
  const zeroAddress = ethers.ZeroAddress;
  const zeroHash = ethers.ZeroHash;
  const teeSignerAddress = process.env.VITE_TEE_VERIFIER_ADDRESS || "0x4870CbC4D07d6Ac2EE5aA865588e5985FE77a4E9";

  console.log("\n--- Deploying System 2: Evolution Lab ---");

  // Deploy FitnessOracle 
  const FitnessOracle = await ethers.getContractFactory("FitnessOracle");
  const fitnessOracle = await FitnessOracle.deploy(teeSignerAddress, zeroHash);
  await fitnessOracle.waitForDeployment();
  console.log("FitnessOracle deployed to:", await fitnessOracle.getAddress());

  // Predict EvolutionClock at N+4 because setGenome transactions increment nonce
  const currentNonce = await ethers.provider.getTransactionCount(deployer.address);
  const evoClockAddress = ethers.getCreateAddress({
    from: deployer.address,
    nonce: currentNonce + 4
  });
  console.log("Predicted EvolutionClock address:", evoClockAddress);

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
      console.log("Actual:", await evolutionClock.getAddress());
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

  console.log("\n--- System 2 Deployment Complete! ---");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
