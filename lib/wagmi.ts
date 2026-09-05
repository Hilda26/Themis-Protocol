"use client";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";
import { GENLAYER_STUDIONET } from "./genlayer/config";

export const studionet = defineChain({
  id: GENLAYER_STUDIONET.chainId,
  name: GENLAYER_STUDIONET.name,
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
  rpcUrls: { default: { http: [GENLAYER_STUDIONET.rpcUrl] } },
  blockExplorers: { default: { name: "GenLayer Explorer", url: GENLAYER_STUDIONET.explorerUrl } },
});

export const wagmiConfig = createConfig({
  chains: [studionet],
  connectors: [injected()],
  transports: { [studionet.id]: http() },
  ssr: true,
});
