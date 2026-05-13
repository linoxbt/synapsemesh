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

export const ZG_MAINNET_ID  = zgMainnet.id;   // 16600
export const ZG_CHAIN_IDS   = [ZG_MAINNET_ID] as const;

// ─── Wagmi config ─────────────────────────────────────────────────────────────
const projectId =
  (import.meta as { env?: Record<string, string> }).env?.VITE_WALLETCONNECT_PROJECT_ID ??
  "f0d6f8162be1beccf221b4e2f8bd7026";

export const wagmiConfig = getDefaultConfig({
  appName: "SynapseMesh",
  projectId,
  chains: [zgMainnet],
  transports: {
    [zgMainnet.id]: http(),
  },
  ssr: true,
});
