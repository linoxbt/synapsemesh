import hardhat from "hardhat";
const { ethers } = hardhat;


async function main() {
  const [deployer] = await ethers.getSigners();
  const AGENT_REGISTRY_ADDR = process.env.VITE_CONTRACT_AGENT_REGISTRY;

  if (!AGENT_REGISTRY_ADDR) throw new Error("AGENT_REGISTRY address not found in .env");

  console.log("Updating MIN_STAKE on AgentRegistry at:", AGENT_REGISTRY_ADDR);
  const AgentRegistry = await ethers.getContractAt("AgentRegistry", AGENT_REGISTRY_ADDR);

  const newMin = ethers.parseEther("0.01");
  const tx = await AgentRegistry.setMinStake(newMin);
  await tx.wait();

  console.log("Success! MIN_STAKE updated to 0.01 OG");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
