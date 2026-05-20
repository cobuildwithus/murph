import {
  buildHostedDeviceSyncMessagingReturnMessageBody,
  readHostedDeviceSyncMessagingReturnTarget,
  resolveHostedDeviceSyncCallbackStatus,
  resolveHostedDeviceSyncMessagingReturnDestination,
  resolveHostedDeviceSyncProviderLabel,
} from "@/src/lib/device-sync/messaging-return-destination";

export function GET(request: Request): Response {
  const url = new URL(request.url);
  const target = readHostedDeviceSyncMessagingReturnTarget(url.searchParams.get("target"));

  if (!target) {
    return htmlResponse(buildInvalidTargetHtml(), 400);
  }

  const providerLabel = resolveHostedDeviceSyncProviderLabel(
    url.searchParams.get("deviceSyncProvider"),
  );
  const status = resolveHostedDeviceSyncCallbackStatus(url.searchParams.get("deviceSyncStatus"));
  const messageBody = buildHostedDeviceSyncMessagingReturnMessageBody(providerLabel);
  const destinationUrl = status === "error"
    ? null
    : resolveHostedDeviceSyncMessagingReturnDestination({
        messageBody,
        recipient: url.searchParams.get("recipient"),
        target,
      });

  return htmlResponse(buildMessagingReturnHtml({
    destinationUrl,
    providerLabel,
    serviceLabel: target === "imessage" ? "Messages" : "Telegram",
    status,
  }));
}

function buildMessagingReturnHtml(input: {
  destinationUrl: string | null;
  providerLabel: string | null;
  serviceLabel: string;
  status: "connected" | "error" | null;
}): string {
  const title = resolveMessagingReturnTitle(input.status, input.providerLabel);
  const escapedDestination = input.destinationUrl ? escapeHtml(input.destinationUrl) : null;
  const escapedService = escapeHtml(input.serviceLabel);
  const message = input.status === "error"
    ? "The connection did not finish. Go home and try again when you are ready."
    : `Returning you to ${escapedService}. If it does not open automatically, use the button below.`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${escapedDestination ? `<meta http-equiv="refresh" content="0;url=${escapedDestination}">` : ""}
  <title>${escapeHtml(title)}</title>
  ${pageStyle()}
</head>
<body>
  <main>
    <p class="eyebrow">Device connection</p>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <div class="actions">
      <a href="/home">Go home</a>
      ${escapedDestination ? `<a href="${escapedDestination}" rel="noreferrer" class="secondary">Text Murph</a>` : ""}
    </div>
  </main>
</body>
</html>`;
}

function buildInvalidTargetHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Device connection return unavailable</title>
  ${pageStyle()}
</head>
<body>
  <main>
    <p class="eyebrow">Device connection</p>
    <h1>Return link unavailable</h1>
    <p>This device connection return link is not supported.</p>
  </main>
</body>
</html>`;
}

function resolveMessagingReturnTitle(
  status: "connected" | "error" | null,
  providerLabel: string | null,
): string {
  if (status === "connected" && providerLabel) {
    return `${providerLabel} is connected`;
  }

  if (status === "connected") {
    return "Device is connected";
  }

  if (status === "error" && providerLabel) {
    return `${providerLabel} connection did not finish`;
  }

  if (status === "error") {
    return "Device connection did not finish";
  }

  return "Returning to messages";
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'",
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
    status,
  });
}

function pageStyle(): string {
  return `<style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #f5f0e8;
      color: #2d3436;
      font-family: "DM Sans", system-ui, sans-serif;
    }
    main {
      width: min(34rem, calc(100vw - 48px));
      padding: 32px 0;
    }
    .eyebrow {
      margin: 0 0 12px;
      color: #736a58;
      font-family: "DM Mono", ui-monospace, monospace;
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0;
      text-transform: uppercase;
    }
    h1 {
      margin: 0;
      font-family: Fraunces, Georgia, serif;
      font-size: 2rem;
      font-weight: 600;
      line-height: 1.15;
    }
    p {
      max-width: 34rem;
      margin: 16px 0 24px;
      color: #736a58;
      font-size: 15px;
      line-height: 1.55;
    }
    .actions {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    a {
      display: inline-flex;
      min-height: 44px;
      align-items: center;
      justify-content: center;
      border-radius: 20px;
      background: #5a6e32;
      color: #fff;
      font-size: 15px;
      font-weight: 500;
      padding: 0 20px;
      text-decoration: none;
    }
    a:hover {
      background: #7a8c6e;
    }
    a:focus-visible {
      outline: 2px solid #7a8c6e;
      outline-offset: 2px;
    }
    a.secondary {
      background: transparent;
      color: #5a6e32;
      border: 1px solid #5a6e32;
    }
    a.secondary:hover {
      background: rgba(90, 110, 50, 0.08);
    }
  </style>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
