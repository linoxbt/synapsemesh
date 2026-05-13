import hardhat from "hardhat";
const { ethers } = hardhat;
import fs from "fs";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Funding from deployer:", deployer.address);

  const agents = [];
  
  // Generate 4 new wallets
  for (let i = 2; i <= 5; i++) {
    const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
    console.log(`Generated Agent ${i}: ${wallet.address}`);
    
    // Send 0.05 OG to each wallet
    const tx = await deployer.sendTransaction({
      to: wallet.address,
      value: ethers.parseEther("0.05")
    });
    console.log(`Funding tx sent: ${tx.hash}`);
    await tx.wait();
    console.log(`Agent ${i} funded!`);

    agents.push({
      id: i,
      name: `Agent-Omega-${i}`,
      address: wallet.address,
      privateKey: wallet.privateKey
    });
  }

  fs.writeFileSync("agents_keys.json", JSON.stringify(agents, null, 2));
  console.log("All agents funded and keys saved to agents_keys.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
