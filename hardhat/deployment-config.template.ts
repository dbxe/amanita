export const deploymentConfig = {
  // Private key of the deployer account, beginning with 0x
  deployerPrivateKey: '0x0000000000000000000000000000000000000000000000000000000000000000',

  // Full URL such as https://abc123.multibaas.com
  deploymentEndpoint: 'http://localhost:8080',

  // The chain ID of the blockchain network
  ethChainID: 1337,

  // API key to access MultiBaas web3 endpoint
  // Note that the API key MUST be part of the "Web3" group
  web3Key: '<API KEY IN WEB3 GROUP>',

  // API key to access MultiBaas from deployer
  // Note that the API key MUST be part of the "Administrators" group
  adminApiKey: '<API KEY IN ADMINISTRATOR GROUP>',
};

export default deploymentConfig;
