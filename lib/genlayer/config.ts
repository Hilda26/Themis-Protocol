export const GENLAYER_STUDIONET = {
  name: "GenLayer Studionet",
  chainId: 61999,
  rpcUrl: "https://studio.genlayer.com/api",
  currency: "GEN",
  explorerUrl: "https://explorer-studio.genlayer.com",
};

export const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS || "";
export const isContractConfigured = () => Boolean(CONTRACT_ADDRESS);

export function getGenlayerExplorerTxUrl(txHash: string): string {
  return `${GENLAYER_STUDIONET.explorerUrl}/tx/${txHash}`;
}

export function getGenlayerExplorerAddressUrl(address: string): string {
  return `${GENLAYER_STUDIONET.explorerUrl}/address/${address}`;
}

export const CONTRACT_MISSING_MESSAGE =
  "Themis is not configured yet.\nDeploy the contract and set NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS to enable live cases.";
