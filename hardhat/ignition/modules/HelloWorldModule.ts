import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { mb } from "hardhat-multibaas-plugin/ignition";

const helloWorldModule = buildModule("HelloWorldModule", (m) => {
  const helloWorldToken = m.contract("HelloWorldToken", [
    "Hello World Token",
    "HWT",
    // 100 tokens with 18 decimals = 100 * 10^18
    100n * 10n ** 18n,
  ]);

  mb.link(helloWorldToken, {
    contractLabel: "helloworld",
    contractVersion: "1.0",
    addressAlias: "helloworld",
    startingBlock: "0",
  });

  return { helloWorldToken };
});

export default helloWorldModule;
