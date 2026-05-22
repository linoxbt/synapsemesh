import { useQueryClient } from "@tanstack/react-query";
import type { MouseEvent } from "react";
import { useWriteContract } from "wagmi";
import { TxStatusPanel } from "@/components/TxStatusPanel";
import { CONTRACT_ADDRESSES, AGENT_REGISTRY_ABI } from "@/lib/contracts";
import type { LiveAgent } from "@/lib/onchain";
import { useTxLifecycle } from "@/lib/tx";
import { useWallet } from "@/lib/wallet";

type UnstakeAgentButtonProps = {
  agent: Pick<LiveAgent, "id" | "owner" | "active">;
  className?: string;
  compact?: boolean;
  showStatus?: boolean;
};

export function UnstakeAgentButton({
  agent,
  className,
  compact = false,
  showStatus = true,
}: UnstakeAgentButtonProps) {
  const queryClient = useQueryClient();
  const { address, isCorrectChain, switchToZg } = useWallet();
  const { writeContractAsync } = useWriteContract();
  const tx = useTxLifecycle<string>();

  const isOwner = !!address && agent.owner.toLowerCase() === address.toLowerCase();
  const isBusy = tx.status === "awaitingWallet" || tx.status === "confirming";

  if (!isOwner || !agent.active) return null;

  const unstake = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (!isCorrectChain) {
      await switchToZg();
      return;
    }

    const outcome = await tx.run(async () => {
      const txHash = await writeContractAsync({
        address: CONTRACT_ADDRESSES.agentRegistry,
        abi: AGENT_REGISTRY_ABI,
        functionName: "deregister",
      });

      return { txHash, result: agent.id };
    });

    if (outcome.status === "success") {
      queryClient.setQueryData<LiveAgent[]>(["liveAgents"], (current) =>
        current?.map((item) =>
          item.id.toLowerCase() === agent.id.toLowerCase()
            ? { ...item, active: false, stake: "0" }
            : item,
        ),
      );
    }

    await queryClient.invalidateQueries({ queryKey: ["liveAgents"] });
  };

  const label = !isCorrectChain
    ? "Switch to 0G"
    : tx.status === "awaitingWallet"
      ? "Confirm..."
      : tx.status === "confirming"
        ? "Unstaking..."
        : compact
          ? "Unstake"
          : "Unstake & go offline";

  const buttonClass =
    className ??
    (compact
      ? "inline-flex items-center justify-center rounded-full border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
      : "inline-flex w-full items-center justify-center rounded-full border border-destructive/40 px-4 py-2.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40");

  return (
    <div>
      <button type="button" onClick={unstake} disabled={isBusy} className={buttonClass}>
        {label}
      </button>
      {showStatus && (
        <TxStatusPanel
          tx={tx}
          labels={{
            confirming: "Returning stake and taking agent offline",
            success: "Stake returned and agent offline",
          }}
        />
      )}
    </div>
  );
}
