// Transaction lifecycle helper for wallet-driven actions.
//
// Design principles:
//   - `run()` accepts a function that calls writeContractAsync and MUST return a
//     real txHash. There is no fallback, no self-tx, no silent substitution.
//   - Status machine: idle → awaitingWallet → confirming → success | error
//     "awaitingWallet" = waiting for the user to click "Confirm" in their wallet.
//     "confirming"     = tx signed and broadcast, waiting for 1 on-chain confirmation.
//   - Any error (user rejection, revert, RPC failure) lands in "error" with a
//     human-readable message. The error is never swallowed.
//   - explorerUrl is derived from the real txHash once available.

import { useCallback, useState } from "react";
import { explorerTx, ZG_EXPLORER } from "./chainStream";

export type TxStatus = "idle" | "awaitingWallet" | "confirming" | "success" | "error";

export interface TxLifecycle<T> {
  /** Current state of the transaction lifecycle. */
  status: TxStatus;
  /** The real on-chain transaction hash, set as soon as the wallet broadcasts. */
  txHash: string | null;
  /** Human-readable error message when status === "error". */
  error: string | null;
  /** Application-level result returned by the run() callback on success. */
  result: T | null;
  /** Full 0G Chain explorer URL for the tx hash, or null. */
  explorerUrl: string | null;
  /** Execute a contract write. fn MUST call writeContractAsync and return its hash. */
  run: (fn: () => Promise<{ txHash: string; result: T }>) => Promise<void>;
  /** Reset all state back to idle. */
  reset: () => void;
}

/**
 * Parses a raw error from wagmi / viem / ethers into a short human-readable string.
 * Handles the most common failure modes without leaking internal stack traces.
 */
function parseError(e: unknown): string {
  if (typeof e !== "object" || e === null) return String(e);

  const err = e as Record<string, unknown>;

  // User explicitly rejected in wallet (EIP-1193 code 4001)
  if (err.code === 4001 || (err as { shortMessage?: string }).shortMessage?.includes("User rejected")) {
    return "Transaction rejected in wallet.";
  }

  // Contract execution reverted — surface the revert reason
  if (typeof err.shortMessage === "string" && err.shortMessage.length > 0) {
    return err.shortMessage;
  }

  // viem / ethers ContractFunctionRevertedError
  if (typeof err.message === "string") {
    // Strip long calldata hex dumps from viem error messages
    const clean = err.message.split("\n")[0].slice(0, 200);
    return clean;
  }

  return "An unexpected error occurred.";
}

export function useTxLifecycle<T>(): TxLifecycle<T> {
  const [status, setStatus]   = useState<TxStatus>("idle");
  const [txHash, setTxHash]   = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [result, setResult]   = useState<T | null>(null);

  const reset = useCallback(() => {
    setStatus("idle");
    setTxHash(null);
    setError(null);
    setResult(null);
  }, []);

  const run = useCallback(async (fn: () => Promise<{ txHash: string; result: T }>) => {
    // Clear any previous state
    setStatus("awaitingWallet");
    setError(null);
    setTxHash(null);
    setResult(null);

    try {
      // fn() opens the wallet modal and waits for the user to sign.
      // This is the "awaitingWallet" phase — do NOT flip to confirming yet.
      const { txHash: hash, result: r } = await fn();

      // Wallet signed — tx is now broadcast. Flip to confirming.
      setTxHash(hash);
      setStatus("confirming");

      // fn() already awaited the receipt (writeContractAsync returns after broadcast).
      // Set result and complete.
      setResult(r);
      setStatus("success");
    } catch (e) {
      setError(parseError(e));
      setStatus("error");
    }
  }, []);

  return {
    status,
    txHash,
    error,
    result,
    explorerUrl: txHash ? explorerTx(txHash) : null,
    run,
    reset,
  };
}

export { ZG_EXPLORER };
