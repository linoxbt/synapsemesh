// Real onchain TEE attestation streamer.
// Polls eth_getLogs against the configured 0G Chain RPC for AttestationPosted
// events emitted by the TEE Verifier contract. Includes:
//   - Last-seen block cursor (persisted to localStorage), clamped on hydration
//     so a stale cursor never triggers a 33M-block backfill
//   - Adaptive chunk size — halves on RPC range errors, grows back on success
//   - Adaptive tick interval — short while catching up, long when steady
//   - Reconnection with exponential backoff on transport errors
//   - Deduplication by `${txHash}:${logIndex}`
//   - Graceful empty state when no contract is configured
//
// Configure via Vite env:
//   VITE_ZG_RPC_URL                (default: https://evmrpc.0g.ai)
//   VITE_ZG_EXPLORER               (default: https://chainscan.0g.ai)
//   VITE_TEE_VERIFIER_ADDRESS      (required for live stream)
//   VITE_TEE_ATTEST_TOPIC          (defaults to keccak256("AttestationPosted(bytes32,bytes32,address,uint256,uint256)"))
//   VITE_INDEX_FROM_BLOCK          (optional lower bound — usually the contract deploy block)
//   VITE_INDEX_LOOKBACK_BLOCKS     (default 10000 — caps how far back to scan)
//   VITE_INDEX_CHUNK_BLOCKS        (default 5000  — target chunk size per eth_getLogs)

import { useEffect, useRef, useState } from "react";

export interface ChainAttestation {
  id: string;          // dedupe key: txHash:logIndex
  txHash: string;
  logIndex: number;
  blockNumber: number;
  dagId: string;
  nodeId: string;
  agent: string;       // address (hex)
  score: number;       // 0-100
  payout: number;      // OG
  timestamp: number;   // ms
}

const ENV =
  (import.meta as { env?: Record<string, string | undefined> }).env ?? {};

const readPositiveInt = (key: string, fallback: number): number => {
  const raw = ENV[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

export const ZG_RPC = ENV.VITE_ZG_RPC_URL || "https://evmrpc.0g.ai";
export const ZG_EXPLORER = ENV.VITE_ZG_EXPLORER || "https://chainscan.0g.ai";
export const TEE_VERIFIER = ENV.VITE_TEE_VERIFIER_ADDRESS || "";
export const TEE_TOPIC =
  ENV.VITE_TEE_ATTEST_TOPIC
  // keccak256("AttestationPosted(bytes32,bytes32,address,uint256,uint256)")
  || "0xeb26a43a6c659dd466d7b33eb02355968ec2f414bf1419f72bcd5674773329c8";

// Bounds for the historical scan. INDEX_FROM_BLOCK is an absolute floor (e.g.
// the contract deploy block); LOOKBACK is a sliding window relative to head.
// We start from max(FROM_BLOCK, head - LOOKBACK) and never scan further back.
const INDEX_FROM_BLOCK = readPositiveInt("VITE_INDEX_FROM_BLOCK", 0);
const INDEX_LOOKBACK_BLOCKS = readPositiveInt("VITE_INDEX_LOOKBACK_BLOCKS", 10_000);
const INDEX_CHUNK_BLOCKS = readPositiveInt("VITE_INDEX_CHUNK_BLOCKS", 5_000);
const MIN_CHUNK_BLOCKS = 100;

// Tick cadence. Catching up should burn through chunks fast; once we are at the
// head we only need to poll for new blocks every few seconds.
const STEADY_TICK_MS = 4_000;
const CATCHUP_TICK_MS = 250;
const MAX_BACKOFF_MS = 30_000;

const CURSOR_KEY = "synapsemesh.tee.cursor";
const SEEN_KEY = "synapsemesh.tee.seen";
const MAX_SEEN = 500;

interface RpcResp<T> { result?: T; error?: { message: string } }

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(ZG_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
  const data = (await res.json()) as RpcResp<T>;
  if (data.error) throw new Error(data.error.message);
  if (data.result === undefined) throw new Error(`RPC ${method} empty result`);
  return data.result;
}

const toNum = (h: string) => parseInt(h, 16);
const toBig = (h: string) => BigInt(h);

function decodeLog(log: {
  transactionHash: string; logIndex: string; blockNumber: string; topics: string[]; data: string;
}): ChainAttestation {
  // topics: [event, dagId, nodeId, agent]; data: score, payout (uint256, uint256)
  const dagId = log.topics[1] ?? "0x";
  const nodeId = log.topics[2] ?? "0x";
  const agent = log.topics[3] ? "0x" + log.topics[3].slice(-40) : "0x";
  const data = log.data.replace(/^0x/, "");
  const score = data.length >= 64 ? Number(toBig("0x" + data.slice(0, 64))) : 0;
  const payoutWei = data.length >= 128 ? toBig("0x" + data.slice(64, 128)) : 0n;
  const payout = Number(payoutWei) / 1e18;
  return {
    id: `${log.transactionHash}:${toNum(log.logIndex)}`,
    txHash: log.transactionHash,
    logIndex: toNum(log.logIndex),
    blockNumber: toNum(log.blockNumber),
    dagId,
    nodeId,
    agent,
    score: Math.min(100, score),
    payout,
    timestamp: Date.now(),
  };
}

// Heuristic: does this look like an "eth_getLogs range too large" error from
// the upstream RPC? Different node implementations word this differently.
const RANGE_ERROR_RE = /range|limit|too many|exceed|wider|max.*block|block.*max/i;

interface StreamState {
  attestations: ChainAttestation[];
  status: "idle" | "connecting" | "live" | "error" | "unconfigured";
  error: string | null;
  cursorBlock: number | null;
}

export function useChainAttestations(limit = 50): StreamState {
  const [state, setState] = useState<StreamState>(() => ({
    attestations: [],
    status: TEE_VERIFIER ? "connecting" : "unconfigured",
    error: null,
    cursorBlock: null,
  }));
  const seenRef = useRef<Set<string>>(new Set());
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (!TEE_VERIFIER) return;
    stoppedRef.current = false;

    // hydrate seen + cursor
    try {
      const seen = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]") as string[];
      seenRef.current = new Set(seen);
    } catch { /* ignore */ }
    let cursor: number | null = null;
    try {
      const c = localStorage.getItem(CURSOR_KEY);
      if (c) {
        const parsed = Number(c);
        if (Number.isFinite(parsed) && parsed >= 0) cursor = parsed;
      }
    } catch { /* ignore */ }

    let chunkSize = INDEX_CHUNK_BLOCKS;
    let errorBackoff = 1_000;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Earliest block we are willing to scan, given the current head. Pulled
    // into a helper because we apply it both on first run AND when hydrating
    // an old cursor — a cursor persisted from a previous (broken) session can
    // be tens of millions of blocks behind head, and without clamping the loop
    // would burn hours catching up.
    const earliestScanBlock = (head: number) =>
      Math.max(INDEX_FROM_BLOCK, head - INDEX_LOOKBACK_BLOCKS);

    async function tick() {
      if (stoppedRef.current) return;
      try {
        const headHex = await rpc<string>("eth_blockNumber", []);
        const head = toNum(headHex);
        const earliest = earliestScanBlock(head);

        if (cursor === null) {
          // First run: position cursor just before `earliest` so the next
          // chunk starts at `earliest`.
          cursor = Math.max(0, earliest - 1);
        } else if (cursor < earliest - 1) {
          // Stale cursor fast-forward. We intentionally drop logs older than
          // the lookback window — operators wanting full history should raise
          // VITE_INDEX_LOOKBACK_BLOCKS or rely on a real indexer.
          cursor = earliest - 1;
        }

        const fromBlock = cursor + 1;

        if (fromBlock > head) {
          // Caught up. Only re-render if something the consumer cares about
          // actually changed.
          setState((s) =>
            s.status === "live" && s.cursorBlock === head && s.error === null
              ? s
              : { ...s, status: "live", error: null, cursorBlock: head },
          );
          errorBackoff = 1_000;
          timer = setTimeout(tick, STEADY_TICK_MS);
          return;
        }

        const toBlock = Math.min(head, fromBlock + chunkSize - 1);

        let logs: Array<{
          transactionHash: string;
          logIndex: string;
          blockNumber: string;
          topics: string[];
          data: string;
        }>;
        try {
          logs = await rpc<typeof logs>("eth_getLogs", [{
            fromBlock: "0x" + fromBlock.toString(16),
            toBlock: "0x" + toBlock.toString(16),
            address: TEE_VERIFIER,
            topics: [TEE_TOPIC],
          }]);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (RANGE_ERROR_RE.test(msg) && chunkSize > MIN_CHUNK_BLOCKS) {
            chunkSize = Math.max(MIN_CHUNK_BLOCKS, Math.floor(chunkSize / 2));
            timer = setTimeout(tick, CATCHUP_TICK_MS);
            return;
          }
          throw err;
        }

        // The request succeeded — try to grow the chunk back toward target.
        if (chunkSize < INDEX_CHUNK_BLOCKS) {
          chunkSize = Math.min(INDEX_CHUNK_BLOCKS, chunkSize * 2);
        }

        const fresh: ChainAttestation[] = [];
        for (const l of logs) {
          const att = decodeLog(l);
          if (seenRef.current.has(att.id)) continue;
          seenRef.current.add(att.id);
          fresh.push(att);
        }
        if (seenRef.current.size > MAX_SEEN) {
          seenRef.current = new Set(Array.from(seenRef.current).slice(-MAX_SEEN));
        }
        cursor = toBlock;
        try {
          localStorage.setItem(CURSOR_KEY, String(cursor));
          if (fresh.length) {
            localStorage.setItem(
              SEEN_KEY,
              JSON.stringify(Array.from(seenRef.current).slice(-MAX_SEEN)),
            );
          }
        } catch { /* ignore */ }

        if (fresh.length) {
          setState((s) => ({
            attestations: [...fresh.reverse(), ...s.attestations].slice(0, limit),
            status: "live",
            error: null,
            cursorBlock: cursor,
          }));
        } else {
          setState((s) =>
            s.status === "live" && s.cursorBlock === cursor && s.error === null
              ? s
              : { ...s, status: "live", error: null, cursorBlock: cursor },
          );
        }

        errorBackoff = 1_000;
        // Adaptive cadence: if we are still meaningfully behind head, drive
        // the next chunk fast; otherwise back off to steady-state polling.
        const behind = head - toBlock;
        const nextDelay = behind > chunkSize ? CATCHUP_TICK_MS : STEADY_TICK_MS;
        timer = setTimeout(tick, nextDelay);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setState((s) => ({ ...s, status: "error", error: msg }));
        errorBackoff = Math.min(errorBackoff * 2, MAX_BACKOFF_MS);
        timer = setTimeout(tick, errorBackoff);
      }
    }

    tick();
    return () => {
      stoppedRef.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [limit]);

  return state;
}

export function explorerTx(hash: string) {
  return `${ZG_EXPLORER}/tx/${hash}`;
}
export function explorerAddr(addr: string) {
  return `${ZG_EXPLORER}/address/${addr}`;
}
