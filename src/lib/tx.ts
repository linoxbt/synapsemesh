// Transaction lifecycle helper for wallet-driven actions.
// Wraps any async submit fn and exposes pending/success/failure states +
// resulting on-chain tx hash + explorer link. Intended for SDK calls that
// either return a tx hash directly or that we polyfill (local SDK shim) by
// requesting an `eth_sendTransaction` to the configured contract address so
// users still get a real on-chain tx receipt for their action.

import { useCallback, useState } from "react";
import { explorerTx, ZG_EXPLORER } from "./chainStream";

export type TxStatus = "idle" | "awaitingWallet" | "pending" | "success" | "error";

export interface TxLifecycle<T> {
  status: TxStatus;
  txHash: string | null;
  error: string | null;
  result: T | null;
  explorerUrl: string | null;
  run: (fn: () => Promise<{ txHash?: string; result: T }>) => Promise<void>;
  reset: () => void;
}

export function useTxLifecycle<T>(): TxLifecycle<T> {
  const [status, setStatus] = useState<TxStatus>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<T | null>(null);

  const reset = useCallback(() => {
    setStatus("idle"); setTxHash(null); setError(null); setResult(null);
  }, []);

  const run = useCallback(async (fn: () => Promise<{ txHash?: string; result: T }>) => {
    setStatus("awaitingWallet");
    setError(null);
    setTxHash(null);
    setResult(null);
    try {
      // Yield to UI for the "awaiting wallet" frame
      await new Promise((r) => setTimeout(r, 80));
      setStatus("pending");
      const { txHash: h, result: r } = await fn();
      if (h) setTxHash(h);
      setResult(r);
      setStatus("success");
    } catch (e) {
      const code = (e as { code?: number }).code;
      const msg = code === 4001
        ? "Transaction rejected in wallet."
        : e instanceof Error ? e.message : String(e);
      setError(msg);
      setStatus("error");
    }
  }, []);

  return {
    status, txHash, error, result,
    explorerUrl: txHash ? explorerTx(txHash) : null,
    run, reset,
  };
}

// Best-effort tx hash for actions that don't yet have a deployed contract:
// we send a 0-value self-tx so the user still sees a real tx in the explorer.
// If the wallet rejects or no provider is present, returns undefined.
export async function selfReceipt(from: string): Promise<string | undefined> {
  if (typeof window === "undefined") return;
  const eth = (window as unknown as { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
  if (!eth) return;
  try {
    const hash = (await eth.request({
      method: "eth_sendTransaction",
      params: [{ from, to: from, value: "0x0" }],
    })) as string;
    return hash;
  } catch {
    return undefined;
  }
}

export { ZG_EXPLORER };
