import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { defineChain } from "viem";
import { http } from "wagmi";

// ─── 0G Aristotle Mainnet ──────────────────────────────────────────────────
export const zgMainnet = defineChain({
  id: 16661,
  name: "0G Aristotle Mainnet",
  nativeCurrency: { name: "0G", symbol: "OG", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://evmrpc.0g.ai"] },
    public: { http: ["https://evmrpc.0g.ai"] },
  },
  blockExplorers: {
    default: { name: "0G Explorer", url: "https://chainscan.0g.ai" },
  },
});

export const ZG_MAINNET_ID = zgMainnet.id;

// ─── Fresh Wagmi v2 Config ────────────────────────────────────────────────
// The project ID provided by the user for WalletConnect to work
const WALLETCONNECT_PROJECT_ID = "f0d6f8162be1beccf221b4e2f8bd7026";

export const wagmiConfig = getDefaultConfig({
  appName: "SynapseMesh",
  projectId: WALLETCONNECT_PROJECT_ID,
  chains: [zgMainnet],
  transports: {
    [zgMainnet.id]: http("https://evmrpc.0g.ai"),
  },
  ssr: true, // Necessary for Next.js/Vite SSR setups
});
