// Thin wagmi-backed adapter for useWallet().
// Keeps the same public API that agents.register, dags.new, dashboard, etc. consume.
// WalletProvider is no longer needed — WagmiProvider in __root.tsx handles the context.

import { useAccount, useChainId, useDisconnect, useSwitchChain } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { ZG_MAINNET_ID, ZG_TESTNET_ID } from "./wagmi";

export interface WalletCtx {
  address: string | null;
  chainId: number | null;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  switchToZg: () => Promise<void>;
  isCorrectChain: boolean;
}

export function useWallet(): WalletCtx {
  const { address, isConnecting } = useAccount();
  const chainId = useChainId();
  const { openConnectModal } = useConnectModal();
  const { disconnectAsync } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();

  const connect = async () => {
    if (openConnectModal) {
      openConnectModal();
    }
  };

  const disconnect = async () => {
    try { await disconnectAsync(); } catch { /* ignore */ }
  };

  const switchToZg = async () => {
    try {
      await switchChainAsync({ chainId: ZG_MAINNET_ID });
    } catch { /* user rejected or chain not available */ }
  };

  const isCorrectChain = chainId === ZG_MAINNET_ID;

  return {
    address: address ?? null,
    chainId: chainId ?? null,
    connecting: isConnecting,
    connect,
    disconnect,
    switchToZg,
    isCorrectChain,
  };
}

export function shortAddr(a: string | null): string {
  if (!a) return "";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
