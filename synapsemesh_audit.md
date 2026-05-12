# SynapseMesh — Full Audit & Fix Plan

> Studied: all 13 route files, all lib files, all components, wagmi config, vercel config.  
> Status as of: 2026-05-12

---

## 1. Feature Implementation Status

| Feature | Route / File | Status | Issue |
|---|---|---|---|
| Landing page | `/` | ✅ Properly built | Contains "Live on 0G **Galileo Testnet**" — must change to mainnet |
| Agent Registry browser | `/agents/` | ✅ Properly built | Works; data is mocked |
| Agent Register | `/agents/register` | ⚠️ Route exists, **page unreachable** | `routeTree.gen.ts` now registers it, but the `"Switch to 0G"` and chain label still says *Galileo*; also calls `selfReceipt()` (mock tx) instead of a real contract |
| Agent Profile | `/agents/$agentId` | ✅ Properly built | Data is mocked |
| Personal Dashboard | `/dashboard` | ✅ Properly built | Filters by wallet — correct. Block counter is mock tick |
| Global Settlements | `/settlements` | ✅ Properly built | Data is mocked; live TEE feed sidebar requires `VITE_TEE_VERIFIER_ADDRESS` |
| DAG Explorer | `/explorer` | ✅ Properly built | Data is mocked |
| DAG Detail | `/explorer/$dagId` | ✅ Properly built | Data is mocked |
| Submit Task DAG | `/dags/new` | ⚠️ UI complete, **submission is mocked** | Calls `selfReceipt()` + `mesh.dags.submit()` (localStorage), not `TaskDAG.sol` |
| Docs | `/docs` | ✅ Properly built | References testnet chain IDs and RPC URLs |
| Protocol | `/protocol` | ⚠️ **Remove or repurpose** | User confirmed it is not necessary; duplicates docs |
| Wallet connect | `SiteHeader` | ❌ **Broken UX** | Clicking connected address disconnects user instead of opening dropdown |
| Chain guard | Multiple pages | ❌ **Wrong chain** | Hardcoded to Galileo (16601). Must target mainnet (16600) |
| Vercel deployment | `vercel.json` | ❌ **404 on all routes** | App builds but deployed URL `synapsemesh.vercel.app` returns 404 |

---

## 2. What is Truly On-Chain vs Mocked

### ✅ Truly On-Chain (zero contract dependency)
- **Wallet connection** — RainbowKit/wagmi reads the real chain. Address, balance, chain-switching are real EIP-1193 calls.
- **Chain block number display** — `useMesh(s => s.block)` is a **fake** ticker (localStorage + setInterval). NOT real.
- **TEE attestation stream** — `chainStream.ts` is real `eth_getLogs` polling once `VITE_TEE_VERIFIER_ADDRESS` is set.

### 🟡 Partially Wired (infrastructure ready, contract address missing)
- `contracts.ts` — ABI stubs written, addresses read from `VITE_CONTRACT_*` env vars. Returns `0x` until deployed.
- `chainStream.ts` — Production-quality event streamer, just needs the verifier address.
- `useTxLifecycle` — Real tx lifecycle hook; `selfReceipt()` fires a real `0x` self-transfer to produce a real tx hash as a placeholder.

### ❌ Fully Mocked (localStorage/in-memory, zero chain reads or writes)
| Mock | Replaces |
|---|---|
| `mesh.agents.register()` | `AgentRegistry.sol → registerAgent()` |
| `mesh.dags.submit()` | `TaskDAG.sol → submitDAG()` + `MeshEscrow.sol → lockBudget()` |
| `mesh.dags.list()` | Onchain event indexing / subgraph |
| `mesh.agents.list()` | Onchain registry enumeration |
| `mesh.attestations.list()` | `chainStream.ts` (TEE events) |
| `mesh.settlements.list()` | `chainStream.ts` + settlement indexer |
| `state.block` | `eth_blockNumber` RPC call |
| Reputation, stake, earnings | `ReputationOracle.sol` + staking balances |
| DAG execution simulation | Real agent network |

---

## 3. Testnet References to Remove

Search and replace all of the following:

| Location | Current text | Replace with |
|---|---|---|
| `index.tsx` L45 | `"Live on 0G Galileo Testnet"` | `"Live on 0G Mainnet"` |
| `agents.register.tsx` L118 | `"0G Galileo"` | `"0G Newton Mainnet"` |
| `dags.new.tsx` L179 | `"0G Galileo"` | `"0G Newton Mainnet"` |
| `docs.tsx` L176-179 | Galileo chain ID, RPC, explorer | Newton mainnet values |
| `wagmi.ts` | `ssr: true`, both chains listed | Keep both but make mainnet **first** (default) |
| `chainStream.ts` L31 | Default RPC `evmrpc-testnet.0g.ai` | `evmrpc.0g.ai` (mainnet) |
| `chainStream.ts` L33 | Default explorer `chainscan-galileo` | `chainscan.0g.ai` (mainnet) |
| `.env.example` | RPC and explorer comments | Mainnet values |
| `SiteHeader.tsx` | Protocol link in nav | Remove |

---

## 4. Known Bugs

### BUG-1: Wallet disconnect on address click ❌
**Root cause:** The `ConnectButton` from RainbowKit is correctly implemented, but the `useWallet().connect()` still calls `connectAsync({ connector: injected() })` which re-triggers connection and may sign the user out on some wallets.  
**Fix:** Remove the manual `connect` button fallback from all pages — the `ConnectButton` in the header handles everything. The address click should open the RainbowKit dropdown (balance, copy address, disconnect). This works by default with RainbowKit *if* no custom `onClick` overrides it.

### BUG-2: `/agents/register` unreachable ❌
**Root cause:** `agents.tsx` renders `<Outlet />` but TanStack Router's dev-server file watcher hasn't regenerated `routeTree.gen.ts` with the `agents.index` route. We manually patched it — it should work after `npm run dev` regenerates.  
**Additional issue:** The URL `/agents/register` requires navigating through `/agents` first in some builds.

### BUG-3: Chain label says "Galileo" on action pages ❌
**Root cause:** `isCorrectChain` in `wallet.tsx` checks both mainnet (16600) and testnet (16601). But the label in `agents.register.tsx` and `dags.new.tsx` hardcodes "0G Galileo" as the display string.  
**Fix:** Change label to "0G Newton Mainnet" and restrict correct chain to mainnet only (remove testnet from `isCorrectChain`).

### BUG-4: Vercel 404 on all routes ❌
**Root cause:** `synapsemesh.vercel.app` returns 404. Despite `vercel.json` having an SPA rewrite, the build output may not be a plain SPA — TanStack Start with SSR/Cloudflare target outputs a server bundle, not `index.html`. Vercel is not finding the entry point.  
**Fix:** Check if the build produces an `index.html` or a Cloudflare Worker entry. Either configure Vercel to use the correct output directory, or switch to a static output preset.

### BUG-5: Block counter is fake ❌
**Root cause:** `sdk.ts` runs `setInterval(() => state.block++, 2500)` in the browser. It's not reading `eth_blockNumber`.  
**Fix (post-contract):** Replace with a real `publicClient.watchBlockNumber()` wagmi call once contracts are live.

### BUG-6: Protocol page is redundant
**Decision:** Remove `/protocol` from navigation and the route itself. Its contract table is a subset of `/docs`. The `Link to="/protocol"` references in `index.tsx` should link to `/docs#architecture` instead.

---

## 5. Prioritised Fix Sequence

### Phase 1 — Deployment (do first, everything else is invisible without this)
1. **Fix Vercel 404** — diagnose build output, configure correct framework preset and output directory in Vercel dashboard, or switch to static export.
2. **Set env vars in Vercel** — `VITE_WALLETCONNECT_PROJECT_ID` is the minimum.

### Phase 2 — Wallet & Chain (users can't do anything without this)
3. **Fix wallet UX** — ensure RainbowKit `ConnectButton` is the sole connection surface; remove all manual `connect()` calls from page buttons.
4. **Remove testnet** — change all Galileo references to Newton Mainnet; restrict `isCorrectChain` to ID 16600 only.
5. **Fix chain guard labels** — "0G Newton Mainnet" everywhere.

### Phase 3 — Navigation & Routes
6. **Remove Protocol page** — delete `protocol.tsx`, remove from `routeTree.gen.ts`, update links to `/docs`.
7. **Verify `/agents/register` reachability** — confirm after dev server regenerates route tree.

### Phase 4 — Content Cleanup
8. **Update docs** — replace all testnet chain info with mainnet values.
9. **Update landing page** — "Live on 0G Mainnet" chip, remove `/protocol` link.

### Phase 5 — Contract Integration (after deployment)
10. **Set `VITE_CONTRACT_*` env vars** in Vercel for each of the 13 deployed contracts.
11. **Wire `agents.register.tsx`** → `meshRegistry.registerAgent()` via wagmi `useWriteContract`.
12. **Wire `dags.new.tsx`** → `taskDag.submitDAG()` + `meshEscrow.lockBudget()`.
13. **Set `VITE_TEE_VERIFIER_ADDRESS`** → live TEE feed activates automatically.
14. **Replace mock block counter** → `publicClient.watchBlockNumber()`.
15. **Replace mock data lists** → subgraph or event indexer queries.

---

## 6. The 13 Contracts (Split by Docs Module)

### Task Economy (6 contracts)
| # | Name | `contracts.ts` key | Status |
|---|---|---|---|
| 1 | AgentRegistry.sol | `meshRegistry` | Not deployed |
| 2 | TaskDAGRegistry.sol | `taskDag` | Not deployed |
| 3 | BidEngine.sol | `meshFactory`* | Not deployed |
| 4 | MeshEscrow.sol | `meshEscrow` | Not deployed |
| 5 | TEEVerifierBridge.sol | `teeVerifier` | Not deployed |
| 6 | RevenueRouter.sol | `meshIncentives`* | Not deployed |

### Evolution Lab (7 contracts)
| # | Name | `contracts.ts` key | Status |
|---|---|---|---|
| 7 | ModelGenome.sol (ERC-7857) | `meshINFT` | Not deployed |
| 8 | GenOps.sol | `meshFactory` | Not deployed |
| 9 | FitnessOracle.sol | `meshOracle` | Not deployed |
| 10 | EvolutionClock.sol | `meshGovernor`* | Not deployed |
| 11 | InferencePool.sol | `meshStaking`* | Not deployed |
| 12 | GenomeMarket.sol | `meshBridge`* | Not deployed |
| 13 | GenomeDAO.sol | `meshTreasury`* | Not deployed |

> *Key mappings in `contracts.ts` need to be renamed to match actual contract names — done during Phase 5.

---

## 7. Mainnet Chain Reference

```
Name:     0G Newton Mainnet
Chain ID: 16600  (0x40D8)
RPC:      https://evmrpc.0g.ai
Explorer: https://chainscan.0g.ai
Symbol:   OG
```
