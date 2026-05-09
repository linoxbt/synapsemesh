// Lightweight wallet provider for 0G Chain via EIP-1193 (MetaMask, Rabby, etc.)
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const ZG_CHAIN = {
  chainId: "0x40D9", // 16601 - 0G Galileo testnet (placeholder until mainnet id ratified)
  chainName: "0G Galileo Testnet",
  nativeCurrency: { name: "0G", symbol: "OG", decimals: 18 },
  rpcUrls: ["https://evmrpc-testnet.0g.ai"],
  blockExplorerUrls: ["https://chainscan-galileo.0g.ai"],
};

type Eip1193 = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, cb: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, cb: (...args: unknown[]) => void) => void;
};

interface WalletCtx {
  address: string | null;
  chainId: string | null;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchToZg: () => Promise<void>;
  isCorrectChain: boolean;
}

const Ctx = createContext<WalletCtx | null>(null);

function getProvider(): Eip1193 | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { ethereum?: Eip1193 }).ethereum ?? null;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const p = getProvider();
    if (!p) return;
    p.request({ method: "eth_accounts" }).then((accs) => {
      const a = (accs as string[])[0];
      if (a) setAddress(a);
    }).catch(() => {});
    p.request({ method: "eth_chainId" }).then((c) => setChainId(c as string)).catch(() => {});

    const onAccounts = (...args: unknown[]) => {
      const accs = args[0] as string[];
      setAddress(accs[0] ?? null);
    };
    const onChain = (...args: unknown[]) => setChainId(args[0] as string);
    p.on?.("accountsChanged", onAccounts);
    p.on?.("chainChanged", onChain);
    return () => {
      p.removeListener?.("accountsChanged", onAccounts);
      p.removeListener?.("chainChanged", onChain);
    };
  }, []);

  const connect = useCallback(async () => {
    const p = getProvider();
    if (!p) {
      alert("No EVM wallet detected. Install MetaMask or another EIP-1193 wallet.");
      return;
    }
    try {
      setConnecting(true);
      const accs = (await p.request({ method: "eth_requestAccounts" })) as string[];
      setAddress(accs[0] ?? null);
      const c = (await p.request({ method: "eth_chainId" })) as string;
      setChainId(c);
    } finally {
      setConnecting(false);
    }
  }, []);

  const switchToZg = useCallback(async () => {
    const p = getProvider();
    if (!p) return;
    try {
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ZG_CHAIN.chainId }] });
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 4902) {
        await p.request({ method: "wallet_addEthereumChain", params: [ZG_CHAIN] });
      }
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
  }, []);

  const value = useMemo<WalletCtx>(() => ({
    address, chainId, connecting, connect, disconnect, switchToZg,
    isCorrectChain: chainId?.toLowerCase() === ZG_CHAIN.chainId.toLowerCase(),
  }), [address, chainId, connecting, connect, disconnect, switchToZg]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const FALLBACK: WalletCtx = {
  address: null,
  chainId: null,
  connecting: false,
  connect: async () => {},
  disconnect: () => {},
  switchToZg: async () => {},
  isCorrectChain: false,
};

export function useWallet() {
  return useContext(Ctx) ?? FALLBACK;
}

export function shortAddr(a: string | null) {
  if (!a) return "";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
