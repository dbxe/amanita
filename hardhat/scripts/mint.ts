import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { network } from "hardhat";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { ethers } = await network.getOrCreate("development");

const WHALE = "0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172";
const WHALE_BALANCE = 100;
const TOTAL_SUPPLY = 1000;
const NUM_RANDOM = 99;
const REMAINING = TOTAL_SUPPLY - WHALE_BALANCE; // 900

function randomAddress(): string {
  const hex = Array.from({ length: 40 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join("");
  return `0x${hex}`;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // Read deployed address from ignition
  const deployedAddressesPath = resolve(
    __dirname,
    "../ignition/deployments/chain-1337/deployed_addresses.json"
  );
  const deployed = JSON.parse(fs.readFileSync(deployedAddressesPath, "utf-8"));
  const tokenAddress = deployed["HelloWorldModule#HelloWorldToken"];
  console.log("HelloWorldToken address:", tokenAddress);

  const Token = await ethers.getContractFactory("HelloWorldToken");
  const token = Token.attach(tokenAddress);

  // Whale gets 100
  console.log(`Transferring ${WHALE_BALANCE} HWT to whale ${WHALE}...`);
  const whaleTx = await token.connect(deployer).transfer(WHALE, WHALE_BALANCE);
  await whaleTx.wait();

  // Generate 99 random accounts with varying amounts that sum to 900
  // Each gets between 5 and 15 tokens, adjusted to hit exactly 900
  const amounts: number[] = Array.from({ length: NUM_RANDOM }, () => 5 + Math.floor(Math.random() * 11)); // 5-15
  let sum = amounts.reduce((a, b) => a + b, 0);

  // Adjust to hit exactly REMAINING
  while (sum < REMAINING) {
    const idx = Math.floor(Math.random() * NUM_RANDOM);
    if (amounts[idx] < 15) {
      amounts[idx]++;
      sum++;
    }
  }
  while (sum > REMAINING) {
    const idx = Math.floor(Math.random() * NUM_RANDOM);
    if (amounts[idx] > 5) {
      amounts[idx]--;
      sum--;
    }
  }

  // Verify max random amount < whale
  const maxRandom = Math.max(...amounts);
  console.assert(maxRandom < WHALE_BALANCE, `Max random amount ${maxRandom} >= whale ${WHALE_BALANCE}`);

  // Distribute to random accounts
  const accounts: { address: string; amount: number }[] = [];
  for (let i = 0; i < NUM_RANDOM; i++) {
    accounts.push({ address: randomAddress(), amount: amounts[i] });
  }

  let txCount = 0;
  for (const acct of accounts) {
    const tx = await token.connect(deployer).transfer(acct.address, acct.amount);
    await tx.wait();
    txCount++;
    if (txCount % 10 === 0 || txCount === accounts.length) {
      console.log(`  Transferred ${txCount}/${accounts.length} accounts`);
    }
  }

  // Summary
  console.log("\n=== Distribution Summary ===");
  console.log(`Whale (${WHALE}): ${WHALE_BALANCE} HWT`);
  console.log(`Random accounts (${NUM_RANDOM}): ${REMAINING} HWT total`);
  console.log(`  Min: ${Math.min(...amounts)} HWT`);
  console.log(`  Max: ${Math.max(...amounts)} HWT`);
  console.log(`  Avg: ${(REMAINING / NUM_RANDOM).toFixed(1)} HWT`);
  console.log(`Total minted: ${TOTAL_SUPPLY} HWT`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
