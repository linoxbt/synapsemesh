import type { TxLifecycle } from "@/lib/tx";

export function TxStatusPanel<T>({ tx, labels }: {
  tx: TxLifecycle<T>;
  labels?: { confirming?: string; success?: string };
}) {
  if (tx.status === "idle") return null;
  const tone =
    tx.status === "success" ? "border-signal/40 text-signal"
    : tx.status === "error" ? "border-destructive/40 text-destructive"
    : "border-accent/40 text-accent";
  const label =
    tx.status === "awaitingWallet" ? "Confirm in your wallet…"
    : tx.status === "confirming"   ? (labels?.confirming ?? "Confirming on 0G Chain…")
    : tx.status === "success"      ? (labels?.success ?? "Transaction confirmed")
    : "Transaction failed";
  return (
    <div className={`mt-4 border rounded-xl p-4 ${tone}`}>
      <div className="flex items-center gap-2">
        {tx.status !== "success" && tx.status !== "error" && (
          <span className="inline-block size-2 rounded-full bg-current animate-pulse" />
        )}
        <p className="font-display text-sm">{label}</p>
      </div>
      {tx.txHash && (
        <a href={tx.explorerUrl!} target="_blank" rel="noreferrer"
          className="mt-2 block font-mono text-[11px] text-muted-foreground hover:text-foreground break-all">
          {tx.txHash} -&gt; view on explorer
        </a>
      )}
      {tx.error && <p className="mt-2 text-[11px] text-muted-foreground">{tx.error}</p>}
    </div>
  );
}
