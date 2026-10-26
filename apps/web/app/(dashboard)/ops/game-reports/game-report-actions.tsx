"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, AlertDescription } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";

interface GameReportActionsProps {
  reportId: string;
  canRemovePost: boolean;
  canEndGames: boolean;
  canSuspend: boolean;
}

type Action = "removePost" | "endGames" | "suspendMember" | "dismiss";

/** One review: the chosen action, then the report leaves the queue. */
export function GameReportActions(props: GameReportActionsProps) {
  const router = useRouter();
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function review(action: Action) {
    setPending(action);
    setError(null);
    try {
      const response = await fetch("/api/ops/game-reports", {
        body: JSON.stringify({ reportId: props.reportId, ...(action === "dismiss" ? {} : { [action]: true }) }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error(`Review failed (${response.status}).`);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Review failed.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {props.canRemovePost ? <Button disabled={pending !== null} onClick={() => review("removePost")} type="button" variant="outline">Remove the post</Button> : null}
        {props.canEndGames ? <Button disabled={pending !== null} onClick={() => review("endGames")} type="button" variant="outline">End their games</Button> : null}
        {props.canSuspend ? <Button disabled={pending !== null} onClick={() => review("suspendMember")} type="button" variant="destructive">Suspend the member</Button> : null}
        <Button disabled={pending !== null} onClick={() => review("dismiss")} type="button" variant="ghost">No action</Button>
      </div>
      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
    </div>
  );
}
