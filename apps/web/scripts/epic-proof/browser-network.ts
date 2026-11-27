import type { Page } from "@playwright/test";
import { origin, vendor } from "./policy";

export const privateContext = { acceptDownloads: false, serviceWorkers: "block" as const };
type Pending = { requestId: string; networkId: string };

// Pause each Chromium request before egress, including redirect hops. Retain only opaque request handles.
export async function boundBrowserNetwork(page: Page) {
  const wire = await page.context().newCDPSession(page);
  const queue: Pending[] = [];
  let active: Pending | undefined, remaining = 160;
  let failure: "app-failure" | "vendor-unavailable" | undefined;
  const failed = () => { failure ??= "app-failure"; };
  function advance() {
    if (active) return;
    active = queue.shift();
    if (active) void wire.send("Fetch.continueRequest", { requestId: active.requestId }).catch(failed);
  }
  function release(networkId: string) {
    if (active?.networkId === networkId) { active = undefined; advance(); }
    else {
      const i = queue.findIndex(r => r.networkId === networkId);
      if (i >= 0) queue.splice(i, 1);
    }
  }
  wire.on("Network.loadingFinished", e => release(e.requestId));
  wire.on("Network.loadingFailed", e => {
    if (e.type === "Document" && active?.networkId === e.requestId && !e.canceled) failure = "vendor-unavailable";
    release(e.requestId);
  });
  wire.on("Network.responseReceived", e => {
    if (e.type === "Document" && e.response.url.startsWith(vendor + "/") && (e.response.status >= 500 || e.response.status === 429))
      failure = "vendor-unavailable";
  });
  wire.on("Fetch.requestPaused", e => {
    // Redirects reuse a Network id and have no loadingFinished event for the preceding hop.
    if (e.redirectedRequestId && active?.requestId === e.redirectedRequestId) { active = undefined; advance(); }
    const destination = new URL(e.request.url).origin;
    if (destination === origin) { void wire.send("Fetch.continueRequest", { requestId: e.requestId }).catch(failed); return; }
    if (destination === vendor && e.networkId && !failure && !["Image", "Font", "Media"].includes(e.resourceType)) {
      if (--remaining >= 0) { queue.push({ requestId: e.requestId, networkId: e.networkId }); advance(); return; }
      failed();
    }
    void wire.send("Fetch.failRequest", { requestId: e.requestId, errorReason: "BlockedByClient" }).catch(failed);
  });
  await wire.send("Network.enable");
  await wire.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  return () => failure;
}
