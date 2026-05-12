# SynapseMesh Deployment Guide

## Architecture

This app uses **TanStack Start with SSR** configured for the **Cloudflare Workers** runtime via `@cloudflare/vite-plugin`. This means:

- `npm run build` produces a **Cloudflare Worker bundle** in `dist/index.js`
- There is **no `index.html`** — the server renders HTML on each request
- **Vercel cannot run this natively** — it would need a Node.js adapter rewrite

## ✅ Correct Deployment Platform: Cloudflare Pages

### Step 1: Push to GitHub
```bash
git add -A
git commit -m "feat: production hardening - mainnet, RainbowKit, contract registry"
git push origin main
```

### Step 2: Create Cloudflare Pages project
1. Go to https://dash.cloudflare.com → **Workers & Pages** → **Create**
2. Choose **Pages** → **Connect to Git**
3. Select your `synapsemesh` repository
4. Set build settings:
   - **Framework preset:** None
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
5. Click **Save and Deploy**

### Step 3: Set Environment Variables in Cloudflare Pages
Go to your Pages project → **Settings** → **Environment variables** and add:

```
VITE_WALLETCONNECT_PROJECT_ID = <your WalletConnect project ID>
VITE_TEE_VERIFIER_ADDRESS     = <deployed after contract deployment>
VITE_CONTRACT_MESH_REGISTRY   = <deployed after contract deployment>
VITE_CONTRACT_TASK_DAG        = <deployed after contract deployment>
VITE_CONTRACT_MESH_ESCROW     = <deployed after contract deployment>
# ... (all 13 VITE_CONTRACT_* vars)
```

### Step 4: Custom Domain (optional)
- In Pages → **Custom domains** → add `synapsemesh.xyz` or your domain
- Cloudflare handles SSL automatically

---

## Why Not Vercel?

| | Vercel | Cloudflare Pages |
|---|---|---|
| Runtime | Node.js (serverless functions) | Workers (V8 isolates) |
| This app's target | ❌ Wrong runtime | ✅ Correct runtime |
| Requires adapter | Yes (major rewrite) | No (built-in) |
| Cold starts | ~200ms | ~0ms (V8 isolates) |
| Free tier | 100GB bandwidth | Unlimited requests |

---

## Local Development

```bash
npm run dev        # Vite dev server with HMR
```

## Preview Production Build Locally

```bash
npm run build
npx wrangler pages dev dist
```
