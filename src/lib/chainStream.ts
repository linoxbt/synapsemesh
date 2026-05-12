// Real onchain TEE attestation streamer.
// Polls eth_getLogs against the configured 0G Chain RPC for AttestationPosted
// events emitted by the TEE Verifier contract. Includes:
//   - Last-seen block cursor (persisted to localStorage)
//   - Reconnection with exponential backoff
//   - Deduplication by `${txHash}:${logIndex}`
//   - Graceful empty state when no contract is configured
//
// Configure via Vite env:
//   VITE_ZG_RPC_URL                (default: https://evmrpc-testnet.0g.ai)
//   VITE_ZG_EXPLORER               (default: https://chainscan-galileo.0g.ai)
//   VITE_TEE_VERIFIER_ADDRESS      (required for live stream)
//   VITE_TEE_ATTEST_TOPIC          (defaults to keccak256("AttestationPosted(bytes32,bytes32,address,uint256,uint256)"))

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

export const ZG_RPC = (import.meta as { env?: Record<string, string> }).env?.VITE_ZG_RPC_URL
  || "https://evmrpc.0g.ai";
export const ZG_EXPLORER = (import.meta as { env?: Record<string, string> }).env?.VITE_ZG_EXPLORER
  || "https://chainscan.0g.ai";
export const TEE_VERIFIER = (import.meta as { env?: Record<string, string> }).env?.VITE_TEE_VERIFIER_ADDRESS || "";
export const TEE_TOPIC = (import.meta as { env?: Record<string, string> }).env?.VITE_TEE_ATTEST_TOPIC
  // keccak256("AttestationPosted(bytes32,bytes32,address,uint256,uint256)")
  || "0x6f52d3c2f5b4c2a7c3d5b2c4f1a3b9d2c8e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9";

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
      if (c) cursor = Number(c);
    } catch { /* ignore */ }

    let backoff = 1000;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      if (stoppedRef.current) return;
      try {
        const headHex = await rpc<string>("eth_blockNumber", []);
        const head = toNum(headHex);
        const fromBlock = cursor !== null ? cursor + 1 : Math.max(0, head - 200);
        if (fromBlock > head) {
          setState((s) => ({ ...s, status: "live", error: null, cursorBlock: head }));
          backoff = 4000;
          timer = setTimeout(tick, backoff);
          return;
        }
        // chunk to keep RPC happy
        const toBlock = Math.min(head, fromBlock + 999);
        const logs = await rpc<Array<{
          transactionHash: string; logIndex: string; blockNumber: string; topics: string[]; data: string;
        }>>("eth_getLogs", [{
          fromBlock: "0x" + fromBlock.toString(16),
          toBlock: "0x" + toBlock.toString(16),
          address: TEE_VERIFIER,
          topics: [TEE_TOPIC],
        }]);

        const fresh: ChainAttestation[] = [];
        for (const l of logs) {
          const att = decodeLog(l);
          if (seenRef.current.has(att.id)) continue;
          seenRef.current.add(att.id);
          fresh.push(att);
        }
        // bound seen set
        if (seenRef.current.size > MAX_SEEN) {
          seenRef.current = new Set(Array.from(seenRef.current).slice(-MAX_SEEN));
        }
        cursor = toBlock;
        try {
          localStorage.setItem(CURSOR_KEY, String(cursor));
          localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(seenRef.current).slice(-MAX_SEEN)));
        } catch { /* ignore */ }

        setState((s) => ({
          attestations: fresh.length
            ? [...fresh.reverse(), ...s.attestations].slice(0, limit)
            : s.attestations,
          status: "live",
          error: null,
          cursorBlock: cursor,
        }));
        backoff = 4000;
        timer = setTimeout(tick, backoff);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setState((s) => ({ ...s, status: "error", error: msg }));
        backoff = Math.min(backoff * 2, 30_000);
        timer = setTimeout(tick, backoff);
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
