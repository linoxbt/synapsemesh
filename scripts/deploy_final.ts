import hre from "hardhat";
const { ethers } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying Final Contracts with the account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  const treasury = deployer.address;
  const modelGenomeAddress = "0x50B7c1301CC7Da2EAd16375301e8977F0c1Ff793";
  const evoClockAddress = "0xB53F9cE714A679775470147DA1d1BdD3a7b47DDd";
  const genOpsAddress = "0x7cB119F6Dd19f1d882ab0F161BE95fC6Eeb38Ceb";

  console.log("\n--- Deploying Final System 2 Extras ---");

  // Deploy InferencePool
  // _genome, _treasury, _platformShare (1000 = 10%)
  const InferencePool = await ethers.getContractFactory("InferencePool");
  const inferencePool = await InferencePool.deploy(modelGenomeAddress, treasury, 1000);
  await inferencePool.waitForDeployment();
  console.log("InferencePool deployed to:", await inferencePool.getAddress());

  // Deploy GenomeMarket
  // _genome, _treasury, _platformFeeBps (250 = 2.5%)
  const GenomeMarket = await ethers.getContractFactory("GenomeMarket");
  const genomeMarket = await GenomeMarket.deploy(modelGenomeAddress, treasury, 250);
  await genomeMarket.waitForDeployment();
  console.log("GenomeMarket deployed to:", await genomeMarket.getAddress());

  // Deploy GenomeDAO
  // _genome, _evoClock, _genOps, _votingPeriod (1000 blocks), _quorum (3)
  const GenomeDAO = await ethers.getContractFactory("GenomeDAO");
  const genomeDAO = await GenomeDAO.deploy(
    modelGenomeAddress,
    evoClockAddress,
    genOpsAddress,
    1000,
    3
  );
  await genomeDAO.waitForDeployment();
  console.log("GenomeDAO deployed to:", await genomeDAO.getAddress());

  console.log("\n--- ALL DEPLOYMENTS COMPLETE! ---");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
