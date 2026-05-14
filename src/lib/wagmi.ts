import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { defineChain } from "viem";
import { http } from "wagmi";

// Read env via the `(import.meta as ...).env` cast pattern used elsewhere in
// this codebase so the file does not depend on a Vite type augmentation.
const ENV =
  (import.meta as { env?: Record<string, string | undefined> }).env ?? {};

const ZG_RPC_URL = ENV.VITE_ZG_RPC_URL || "https://evmrpc.0g.ai";
const ZG_EXPLORER = ENV.VITE_ZG_EXPLORER || "https://chainscan.0g.ai";

// 0G Aristotle Mainnet — id 16661, native token OG.
// Confirmed against https://evmrpc.0g.ai (the production mainnet RPC).
export const zgMainnet = defineChain({
  id: 16661,
  name: "0G Aristotle Mainnet",
  nativeCurrency: { name: "0G", symbol: "OG", decimals: 18 },
  rpcUrls: {
    default: { http: [ZG_RPC_URL] },
    public: { http: [ZG_RPC_URL] },
  },
  blockExplorers: {
    default: { name: "0G Explorer", url: ZG_EXPLORER },
  },
});

export const ZG_MAINNET_ID = zgMainnet.id;

// Reown / WalletConnect project ID. Loaded from env so the same build can be
// promoted between environments without recompiling. RainbowKit hangs at the
// WC pairing handshake if this is empty or invalid — surface that loudly.
const WALLETCONNECT_PROJECT_ID = ENV.VITE_WALLETCONNECT_PROJECT_ID ?? "";

if (!WALLETCONNECT_PROJECT_ID && typeof console !== "undefined") {
  // eslint-disable-next-line no-console
  console.warn(
    "[wagmi] VITE_WALLETCONNECT_PROJECT_ID is not set. WalletConnect-based wallets (mobile QR pairing) will not connect.",
  );
}

export const wagmiConfig = getDefaultConfig({
  appName: "SynapseMesh",
  // Pass a stable placeholder when missing so getDefaultConfig does not throw
  // at module init time; the warning above tells the operator it is unset.
  projectId: WALLETCONNECT_PROJECT_ID || "missing-walletconnect-project-id",
  chains: [zgMainnet],
  transports: {
    [zgMainnet.id]: http(ZG_RPC_URL),
  },
  // This app is a Vite SPA (see src/main.tsx — pure createRoot, no hydrate).
  // `ssr: true` causes wagmi to defer connector setup expecting hydration that
  // never happens, which manifests as the RainbowKit connect modal hanging on
  // first open.
  ssr: false,
});
