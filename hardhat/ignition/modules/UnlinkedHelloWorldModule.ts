import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const unlinkedHelloWorldModule = buildModule("UnlinkedHelloWorldModule", (m) => {
  const unlinkedHelloWorldToken = m.contract("HelloWorldToken", [
    "Unlinked Hello World Token",
    "UHWT",
    1000n * 10n ** 18n,
  ]);

  return { unlinkedHelloWorldToken };
});

export default unlinkedHelloWorldModule;
