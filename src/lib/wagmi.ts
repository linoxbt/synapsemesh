import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { defineChain } from "viem";
import { http } from "wagmi";

const env = (import.meta as { env?: Record<string, string> }).env ?? {};

const ZG_RPC = env.VITE_ZG_RPC_URL || "https://evmrpc.0g.ai";
const ZG_EXPLORER = env.VITE_ZG_EXPLORER || "https://chainscan.0g.ai";

// ─── 0G Mainnet (Aleph) ──────────────────────────────────────────────────────
// Real chain id confirmed via eth_chainId on https://evmrpc.0g.ai → 0x4115 = 16661.
export const zgMainnet = defineChain({
  id: 16661,
  name: "0G Mainnet",
  nativeCurrency: { name: "0G", symbol: "OG", decimals: 18 },
  rpcUrls: {
    default: { http: [ZG_RPC] },
    public:  { http: [ZG_RPC] },
  },
  blockExplorers: {
    default: { name: "0G Explorer", url: ZG_EXPLORER },
  },
});

export const ZG_MAINNET_ID = zgMainnet.id; // 16661
export const ZG_CHAIN_IDS  = [ZG_MAINNET_ID] as const;

// ─── Wagmi config ─────────────────────────────────────────────────────────────
// projectId MUST be a real WalletConnect Cloud id, otherwise the RainbowKit
// modal hangs on the WC v2 relay handshake and the wallet list never renders.
const projectId = env.VITE_WALLETCONNECT_PROJECT_ID || "";

if (!projectId && typeof window !== "undefined") {
  // Surface clearly in dev — empty id makes WC pairing hang silently.
  console.warn("[wagmi] VITE_WALLETCONNECT_PROJECT_ID is not set. WalletConnect pairing will fail.");
}

export const wagmiConfig = getDefaultConfig({
  appName: "SynapseMesh",
  projectId: projectId || "synapsemesh-local",
  chains: [zgMainnet],
  transports: {
    [zgMainnet.id]: http(ZG_RPC),
  },
  ssr: true,
});
