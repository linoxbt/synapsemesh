import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { TxStatusPanel } from "@/components/TxStatusPanel";
import { mesh, type AgentOp, type Agent } from "@/lib/sdk";
import { useWallet } from "@/lib/wallet";
import { useTxLifecycle, selfReceipt } from "@/lib/tx";

export const Route = createFileRoute("/agents/register")({
  head: () => ({
    meta: [
      { title: "Register Agent - SynapseMesh" },
      { name: "description", content: "Register an autonomous agent on 0G Chain. Mint an ERC-7857 INFT, lock stake and declare capabilities via the SDK." },
      { property: "og:title", content: "Register Agent - SynapseMesh" },
      { property: "og:description", content: "Stake, mint INFT and join the SynapseMesh registry." },
    ],
  }),
  component: RegisterAgentPage,
});

const OPS: AgentOp[] = ["Researcher", "Writer", "Verifier", "Vision", "Aggregator", "Coder", "Custom"];

function RegisterAgentPage() {
  const { address, connect, isCorrectChain, switchToZg } = useWallet();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [op, setOp] = useState<AgentOp>("Researcher");
  const [stake, setStake] = useState(100);
  const [caps, setCaps] = useState("");
  const [endpoint, setEndpoint] = useState("");

  const capList = caps.split(",").map((c) => c.trim()).filter(Boolean);
  const canSubmit = !!address && isCorrectChain && name.trim().length > 0 && stake > 0 && capList.length > 0;

  const submit = () => {
    if (!canSubmit) return;
    const a = mesh.agents.register({
      name: name.trim(),
      op,
      stake,
      capabilities: capList,
      owner: address!,
    });
    navigate({ to: "/agents/$agentId", params: { agentId: a.id } });
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="aurora">
          <div className="container-edge pt-20 pb-10">
            <span className="chip">Registry</span>
            <h1 className="editorial-h1 text-4xl md:text-6xl mt-6 max-w-3xl">
              Register an <em className="italic text-accent">agent.</em>
            </h1>
            <p className="text-muted-foreground mt-5 max-w-xl text-sm">
              Stakes OG into AgentRegistry.sol and mints an ERC-7857 INFT representing the agent's identity, capabilities and reputation.
            </p>
          </div>
        </section>

        <section className="container-edge py-10 grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 card-soft p-6 grid gap-5">
            <Field label="Agent name">
              <input
                value={name} onChange={(e) => setName(e.target.value)}
                placeholder="claude-r1"
                className="w-full bg-secondary/40 border border-border rounded-lg px-3 py-2 text-sm"
              />
            </Field>

            <div className="grid sm:grid-cols-2 gap-5">
              <Field label="Operation">
                <select value={op} onChange={(e) => setOp(e.target.value as AgentOp)}
                  className="w-full bg-secondary/40 border border-border rounded-lg px-3 py-2 text-sm">
                  {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </Field>
              <Field label="Stake (OG)">
                <input type="number" min={1} value={stake} onChange={(e) => setStake(Number(e.target.value))}
                  className="w-full bg-secondary/40 border border-border rounded-lg px-3 py-2 text-sm font-mono" />
              </Field>
            </div>

            <Field label="Capabilities (comma-separated)">
              <input value={caps} onChange={(e) => setCaps(e.target.value)}
                placeholder="search, synthesis, summarization"
                className="w-full bg-secondary/40 border border-border rounded-lg px-3 py-2 text-sm font-mono" />
              {capList.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {capList.map((c) => (
                    <span key={c} className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-border/60 text-muted-foreground">{c}</span>
                  ))}
                </div>
              )}
            </Field>

            <Field label="Service endpoint (optional)">
              <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)}
                placeholder="https://agent.example.com/inference"
                className="w-full bg-secondary/40 border border-border rounded-lg px-3 py-2 text-sm font-mono" />
            </Field>
          </div>

          <aside className="card-soft p-6 h-fit lg:sticky lg:top-24">
            <h3 className="font-display text-xl">Summary</h3>
            <dl className="mt-5 space-y-3 text-sm">
              <Row k="Owner" v={address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Not connected"} />
              <Row k="Chain" v={isCorrectChain ? "0G Galileo" : "Wrong network"} />
              <Row k="Stake locked" v={`${stake} OG`} />
              <Row k="Capabilities" v={String(capList.length)} />
            </dl>
            <div className="hairline my-5" />
            {!address ? (
              <button onClick={connect} className="btn-primary w-full">Connect wallet</button>
            ) : !isCorrectChain ? (
              <button onClick={switchToZg} className="btn-primary w-full">Switch to 0G</button>
            ) : (
              <button onClick={submit} disabled={!canSubmit}
                className="btn-primary w-full disabled:opacity-40 disabled:cursor-not-allowed">
                Stake {stake} OG &amp; mint INFT
              </button>
            )}
            <p className="text-[11px] text-muted-foreground mt-3">
              Calls AgentRegistry.register() then mints an ERC-7857 INFT in a single tx.
            </p>
          </aside>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-widest text-muted-foreground mb-2">{label}</label>
      {children}
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-mono text-right truncate">{v}</dd>
    </div>
  );
}
