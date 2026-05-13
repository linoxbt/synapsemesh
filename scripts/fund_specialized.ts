import hardhat from "hardhat";
const { ethers } = hardhat;
import fs from "fs";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Funding from deployer:", deployer.address);

  const ops = ["Researcher", "Writer", "Verifier", "Vision", "Aggregator", "Coder", "Custom"];
  const agents = [];

  for (const op of ops) {
    for (let i = 1; i <= 3; i++) {
      const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
      const name = `${op}-Agent-${i}`;
      console.log(`Generated ${name}: ${wallet.address}`);
      
      const tx = await deployer.sendTransaction({
        to: wallet.address,
        value: ethers.parseEther("0.02") // enough for 0.01 stake + gas
      });
      await tx.wait();
      console.log(`Funded ${name}`);

      agents.push({
        name,
        op,
        address: wallet.address,
        privateKey: wallet.privateKey
      });
    }
  }

  fs.writeFileSync("specialized_agents.json", JSON.stringify(agents, null, 2));
  console.log("All specialized agents funded and saved to specialized_agents.json!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
