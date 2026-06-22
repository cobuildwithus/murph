import {
  completeHostedConnectedAppConnection,
} from "@/src/lib/connected-apps/service";
import { formatHostedConnectedAppToolkitLabel } from "@/src/lib/connected-apps/config";
import {
  resolveHostedDeviceSyncAssignedMessagesReturnDestination,
  resolveHostedDeviceSyncMessagingReturnDestination,
} from "@/src/lib/device-sync/messaging-return-destination";
import { isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { readHostedMemberRoutingState } from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { getPrisma } from "@/src/lib/prisma";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const claim = url.searchParams.get("claim") ?? "";
  const status = url.searchParams.get("status");
  const connectedAccountId = url.searchParams.get("connected_account_id") ?? "";

  if (status !== "success" || !claim || !connectedAccountId) {
    return completionPage({
      detail: "The connection did not finish. Ask Murph for a new link when you are ready.",
      title: "Connection did not finish",
    });
  }

  try {
    const completed = await completeHostedConnectedAppConnection({
      claim,
      connectedAccountId,
    });
    const toolkitLabel = formatHostedConnectedAppToolkitLabel(
      completed.intent.toolkit,
    );
    const accountLabel = completed.intent.alias
      ? `${completed.intent.alias} ${toolkitLabel}`
      : toolkitLabel;
    const messageBody = completed.intent.alias
      ? `I just connected my ${accountLabel}`
      : `I just connected ${toolkitLabel}`;
    const routing = await readHostedMemberRoutingState({
      memberId: completed.intent.memberId,
      prisma: getPrisma(),
    });
    const messagesHref = resolveHostedDeviceSyncAssignedMessagesReturnDestination({
      messageBody,
      recipient: routing?.linqRecipientPhone ?? null,
    });
    const telegramHref = !messagesHref && (routing?.telegramThreadId || routing?.telegramUserId)
      ? resolveHostedDeviceSyncMessagingReturnDestination({
          messageBody,
          recipient: null,
          target: "telegram",
        })
      : null;

    return completionPage({
      actionHref: messagesHref ?? telegramHref,
      detail: `${accountLabel} is ready. Text Murph to start using it.`,
      title: `${accountLabel} is connected`,
    });
  } catch (error) {
    if (!isHostedOnboardingError(error)) {
      console.error("Connected-app callback failed unexpectedly.", {
        errorType: error instanceof Error ? error.name : typeof error,
      });
    }
    return completionPage({
      detail: isHostedOnboardingError(error)
        ? error.message
        : "Murph could not verify this connection. Ask for a new link.",
      title: "Connection could not be verified",
    });
  }
}

function completionPage(input: {
  actionHref?: string | null;
  detail: string;
  title: string;
}): Response {
  const action = input.actionHref
    ? `<a href="${escapeHtml(input.actionHref)}" rel="noreferrer">Text Murph</a>`
    : `<a href="/home">Go home</a>`;
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.title)}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f5f0e8; color: #2d3436; font-family: "DM Sans", system-ui, sans-serif; }
    main { width: min(34rem, calc(100vw - 48px)); padding: 32px 0; }
    .eyebrow { margin: 0 0 12px; color: #736a58; font: 500 10px "DM Mono", ui-monospace, monospace; text-transform: uppercase; }
    h1 { margin: 0; font-family: Fraunces, Georgia, serif; font-size: 2rem; line-height: 1.15; overflow-wrap: anywhere; }
    p { margin: 16px 0 24px; color: #736a58; font-size: 15px; line-height: 1.55; overflow-wrap: anywhere; }
    a { min-height: 44px; border-radius: 20px; display: inline-flex; align-items: center; justify-content: center; background: #5a6e32; color: #fff; font-size: 15px; font-weight: 500; padding: 0 20px; text-decoration: none; }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">Connected apps</p>
    <h1>${escapeHtml(input.title)}</h1>
    <p>${escapeHtml(input.detail)}</p>
    ${action}
  </main>
</body>
</html>`, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'",
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
