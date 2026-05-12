// Wagmi v2 + RainbowKit configuration
// Defines 0G Newton Mainnet (16600) and 0G Galileo Testnet (16601) as custom chains.
// VITE_WALLETCONNECT_PROJECT_ID must be set in .env — get one free at https://cloud.walletconnect.com

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { defineChain } from "viem";
import { http } from "wagmi";

// ─── 0G Newton Mainnet ───────────────────────────────────────────────────────
export const zgMainnet = defineChain({
  id: 16600,
  name: "0G Newton Mainnet",
  nativeCurrency: { name: "0G", symbol: "OG", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://evmrpc.0g.ai"] },
    public:  { http: ["https://evmrpc.0g.ai"] },
  },
  blockExplorers: {
    default: { name: "0G Explorer", url: "https://chainscan.0g.ai" },
  },
});

// ─── 0G Galileo Testnet ──────────────────────────────────────────────────────
export const zgGalileo = defineChain({
  id: 16601,
  name: "0G Galileo Testnet",
  nativeCurrency: { name: "0G", symbol: "OG", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://evmrpc-testnet.0g.ai"] },
    public:  { http: ["https://evmrpc-testnet.0g.ai"] },
  },
  blockExplorers: {
    default: { name: "0G Galileo Explorer", url: "https://chainscan-galileo.0g.ai" },
  },
  testnet: true,
});

export const ZG_MAINNET_ID  = zgMainnet.id;   // 16600
export const ZG_TESTNET_ID  = zgGalileo.id;   // 16601
export const ZG_CHAIN_IDS   = [ZG_MAINNET_ID, ZG_TESTNET_ID] as const;

// ─── Wagmi config ─────────────────────────────────────────────────────────────
const projectId =
  (import.meta as { env?: Record<string, string> }).env?.VITE_WALLETCONNECT_PROJECT_ID ??
  "f0d6f8162be1beccf221b4e2f8bd7026";

export const wagmiConfig = getDefaultConfig({
  appName: "SynapseMesh",
  projectId,
  // Mainnet FIRST — this is the default chain shown in RainbowKit
  chains: [zgMainnet, zgGalileo],
  transports: {
    [zgMainnet.id]:  http(),
    [zgGalileo.id]:  http(),
  },
  ssr: true,   // TanStack Start is SSR — required for proper hydration
});
