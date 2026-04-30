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
const REMAINING = TOTAL_SUPPLY - WHALE_BALANCE;
const DECIMALS = 18n;
const toWei = (n: number) => BigInt(n) * 10n ** DECIMALS;

function randomAddress(): string {
  const hex = Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `0x${hex}`;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const deployedAddressesPath = resolve(__dirname, "../ignition/deployments/chain-1337/deployed_addresses.json");
  const deployed = JSON.parse(fs.readFileSync(deployedAddressesPath, "utf-8"));
  const tokenAddress =
    deployed["UnlinkedHelloWorldModule#unlinkedHelloWorldToken"] ??
    deployed["UnlinkedHelloWorldModule#HelloWorldToken"];
  if (!tokenAddress) {
    throw new Error(
      "UnlinkedHelloWorldModule deployment not found. Run `npm run deploy-unlinked` in hardhat/ first.",
    );
  }

  console.log("UnlinkedHelloWorldToken address:", tokenAddress);

  const Token = await ethers.getContractFactory("HelloWorldToken");
  const token = Token.attach(tokenAddress);

  console.log(`Transferring ${WHALE_BALANCE} UHWT to whale ${WHALE}...`);
  const whaleTx = await token.connect(deployer).transfer(WHALE, toWei(WHALE_BALANCE));
  await whaleTx.wait();

  const amounts: number[] = Array.from({ length: NUM_RANDOM }, () => 5 + Math.floor(Math.random() * 11));
  let sum = amounts.reduce((a, b) => a + b, 0);

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

  const maxRandom = Math.max(...amounts);
  console.assert(maxRandom < WHALE_BALANCE, `Max random amount ${maxRandom} >= whale ${WHALE_BALANCE}`);

  const accounts: { address: string; amount: number }[] = [];
  for (let i = 0; i < NUM_RANDOM; i++) {
    accounts.push({ address: randomAddress(), amount: amounts[i] });
  }

  let txCount = 0;
  for (const acct of accounts) {
    const tx = await token.connect(deployer).transfer(acct.address, toWei(acct.amount));
    await tx.wait();
    txCount++;
    if (txCount % 10 === 0 || txCount === accounts.length) {
      console.log(`  Transferred ${txCount}/${accounts.length} accounts`);
    }
  }

  console.log("\n=== Distribution Summary ===");
  console.log(`Whale (${WHALE}): ${WHALE_BALANCE} UHWT`);
  console.log(`Random accounts (${NUM_RANDOM}): ${REMAINING} UHWT total`);
  console.log(`  Min: ${Math.min(...amounts)} UHWT`);
  console.log(`  Max: ${Math.max(...amounts)} UHWT`);
  console.log(`  Avg: ${(REMAINING / NUM_RANDOM).toFixed(1)} UHWT`);
  console.log(`Total minted: ${TOTAL_SUPPLY} UHWT`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
