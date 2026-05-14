import {
  connectorsForWallets,
} from "@rainbow-me/rainbowkit";
import {
  rainbowWallet,
  walletConnectWallet,
  metaMaskWallet,
  coinbaseWallet,
  injectedWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { defineChain } from "viem";
import { createConfig, http } from "wagmi";

const env = (import.meta as { env?: Record<string, string> }).env ?? {};

const ZG_RPC      = env.VITE_ZG_RPC_URL  || "https://evmrpc.0g.ai";
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

// ─── WalletConnect Project ID ─────────────────────────────────────────────────
// A real UUIDv4 from https://cloud.reown.com (formerly WalletConnect Cloud).
// If this is absent or a placeholder, WalletConnect is excluded from the wallet
// list entirely so the modal does not hang waiting for the relay.
const rawProjectId = env.VITE_WALLETCONNECT_PROJECT_ID ?? "";

// A valid WalletConnect projectId is a 32-char hex UUID (no dashes).
// Anything shorter or obviously fake is treated as "not configured".
const isValidProjectId = rawProjectId.length >= 32 && rawProjectId !== "synapsemesh-local";

if (!isValidProjectId && typeof window !== "undefined") {
  console.warn(
    "[wagmi] VITE_WALLETCONNECT_PROJECT_ID is missing or invalid. " +
    "WalletConnect (MetaMask Mobile, Rainbow, etc.) will be hidden from the " +
    "wallet modal. Get a free project ID at https://cloud.reown.com and add " +
    "it to your .env file to enable mobile wallet support."
  );
}

export const walletConnectProjectId = isValidProjectId ? rawProjectId : "";

// ─── Wallet list: conditionally include WalletConnect ─────────────────────────
// injectedWallet   → MetaMask browser extension, Rabby, etc. (always available)
// metaMaskWallet   → MetaMask deep-link for in-app browser (always available)
// walletConnectWallet, rainbowWallet, coinbaseWallet → need a valid project ID
const walletGroups = isValidProjectId
  ? [
      {
        groupName: "Popular",
        wallets: [metaMaskWallet, rainbowWallet, walletConnectWallet, coinbaseWallet],
      },
      {
        groupName: "Other",
        wallets: [injectedWallet],
      },
    ]
  : [
      {
        groupName: "Browser wallets",
        wallets: [metaMaskWallet, injectedWallet],
      },
    ];

const connectors = connectorsForWallets(walletGroups, {
  appName: "SynapseMesh",
  projectId: walletConnectProjectId || "00000000000000000000000000000000", // placeholder never reaches WC relay
});

// ─── Wagmi config ─────────────────────────────────────────────────────────────
export const wagmiConfig = createConfig({
  connectors,
  chains: [zgMainnet],
  transports: {
    [zgMainnet.id]: http(ZG_RPC),
  },
  ssr: true,
});
