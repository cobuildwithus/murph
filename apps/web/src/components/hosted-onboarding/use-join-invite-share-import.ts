import { startTransition, useEffect, useEffectEvent, useState } from "react";

import type { AcceptHostedShareResult, HostedSharePageData } from "@/src/lib/hosted-share/service";

import { requestHostedOnboardingJson } from "./client-api";
import {
  buildHostedShareStatusUrl,
  resolveJoinInviteShareStateFromAccept,
  resolveJoinInviteShareStateFromStatus,
  type JoinInviteShareImportState,
} from "./join-invite-state";

export function useJoinInviteShareImport(input: {
  inviteCode: string;
  onErrorMessage: (message: string | null) => void;
  onPendingAction: (action: "share" | null) => void;
  shareCode: string | null;
  statusStage: string;
}) {
  const [shareImportState, setShareImportState] = useState<JoinInviteShareImportState>("idle");

  const acceptShareEffect = useEffectEvent(() => {
    void handleAcceptShare();
  });

  useEffect(() => {
    if (!input.shareCode || shareImportState !== "idle" || input.statusStage !== "active") {
      return;
    }

    acceptShareEffect();
  }, [input.shareCode, input.statusStage, shareImportState]);

  useEffect(() => {
    const shareCode = input.shareCode;

    if (!shareCode || shareImportState !== "processing") {
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const payload = await requestHostedOnboardingJson<HostedSharePageData>({
          auth: "optional",
          url: buildHostedShareStatusUrl({
            inviteCode: input.inviteCode,
            shareCode,
          }),
        });

        if (cancelled) {
          return;
        }

        startTransition(() => {
          setShareImportState(resolveJoinInviteShareStateFromStatus(payload));
        });
      } catch {
        // Keep polling; transient status failures should not reset the pending state.
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 3_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [input.inviteCode, input.shareCode, shareImportState]);

  async function handleAcceptShare() {
    if (!input.shareCode || shareImportState === "completed") {
      return;
    }

    input.onErrorMessage(null);
    input.onPendingAction("share");

    try {
      const payload = await requestHostedOnboardingJson<Pick<
        AcceptHostedShareResult,
        "alreadyImported" | "imported" | "pending"
      >>({
        payload: {},
        url: `/api/hosted-share/${encodeURIComponent(input.shareCode)}/accept`,
      });
      setShareImportState(resolveJoinInviteShareStateFromAccept(payload));
    } catch (error) {
      input.onErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      input.onPendingAction(null);
    }
  }

  return {
    handleAcceptShare,
    shareImportState,
  };
}
