import { network } from "hardhat";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  // Connect to the development network (MultiBaas localhost)
  const connection = await network.getOrCreate("development");
  const { ethers } = connection;

  const recipient = "0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172";
  const amount = 100n * 10n ** 18n; // 100 tokens with 18 decimals

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // Read the deployed contract address from ignition deployment
  const fs = await import("fs");

  const deploymentDir = path.join(__dirname, "../ignition/deployments");
  const deploymentFiles = fs.readdirSync(deploymentDir);
  const latestDeployment = deploymentFiles
    .filter((f) => f !== "latest")
    .sort()
    .pop();

  if (!latestDeployment) {
    console.error("No deployment found. Please run `npm run deploy` first.");
    process.exit(1);
  }

  const deployedAddressesPath = path.join(
    deploymentDir,
    latestDeployment,
    "deployed_addresses.json",
  );
  const deployedAddresses = JSON.parse(
    fs.readFileSync(deployedAddressesPath, "utf-8"),
  );

  const contractAddress = deployedAddresses["HelloWorldModule#HelloWorldToken"];

  if (!contractAddress) {
    console.error("HelloWorldToken address not found in deployment.");
    process.exit(1);
  }

  console.log("HelloWorldToken address:", contractAddress);

  const HelloWorldToken = await ethers.getContractFactory(
    "HelloWorldToken",
    deployer,
  );
  const token = HelloWorldToken.attach(contractAddress);

  console.log(`Transferring 100 HWT to ${recipient}...`);
  const tx = await token.transfer(recipient, amount);
  console.log("Transaction hash:", tx.hash);
  const receipt = await tx.wait();
  console.log("Block:", receipt?.blockNumber);

  const recipientBalance = await token.balanceOf(recipient);
  const deployerBalance = await token.balanceOf(deployer.address);

  console.log(
    `Recipient (${recipient}) balance: ${ethers.formatUnits(
      recipientBalance,
      18,
    )} HWT`,
  );
  console.log(
    `Deployer (${deployer.address}) balance: ${ethers.formatUnits(
      deployerBalance,
      18,
    )} HWT`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
