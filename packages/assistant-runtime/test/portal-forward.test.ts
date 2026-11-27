import { expect, it, vi } from "vitest";
import { forwardedPortalFallback, portalDiscoveryAssistantInput, portalDiscoverySummary } from "@murphai/clinical-records/portal-discovery-link";
import type { HostedExecutionConversationMessageWake } from "@murphai/hosted-execution";
import { readPortalForwardForAssistant } from "../src/hosted-runtime/events/email.ts";

it("hydrates the private Find suggestion only for a direct portal wake and falls back on missing evidence", async () => {
  const wake = { kind: "conversation.message", eventId: "synthetic-event", userId: "synthetic-member", occurredAt: "2031-02-01T12:00:00.000Z",
    message: { channel: "email", identityId: null, rawMessageKey: "opaque", threadIsDirect: true,
      subject: "Forwarded patient portal notice", textPreview: forwardedPortalFallback },
  } satisfies HostedExecutionConversationMessageWake;
  const summary = portalDiscoverySummary({ id: "epic-sample", brandName: "Copper Basin" });
  const bytes = new TextEncoder().encode(`Content-Type: text/plain\r\n\r\n${summary}`);
  const readRawEmailMessage = vi.fn(async (_key: string): Promise<Uint8Array | null> => bytes);
  const port = { readRawEmailMessage };
  const group = { ...wake, message: { ...wake.message, threadIsDirect: false } };
  expect(await readPortalForwardForAssistant(group, port)).toBeNull();
  expect(readRawEmailMessage).not.toHaveBeenCalled();
  expect(await readPortalForwardForAssistant(wake, port)).toBe(portalDiscoveryAssistantInput(summary));
  expect(readRawEmailMessage).toHaveBeenCalledExactlyOnceWith("opaque");
  const search = portalDiscoverySummary({ brandName: "Crescent Pavilion" });
  readRawEmailMessage.mockResolvedValueOnce(new TextEncoder().encode(`Content-Type: text/plain\r\n\r\n${search}`));
  expect(await readPortalForwardForAssistant(wake, port)).toBe(portalDiscoveryAssistantInput(search));
  readRawEmailMessage.mockResolvedValueOnce(null);
  expect(await readPortalForwardForAssistant(wake, port)).toBe(portalDiscoveryAssistantInput(forwardedPortalFallback));
  readRawEmailMessage.mockResolvedValueOnce(new TextEncoder().encode(`Content-Type: text/plain\r\n\r\n${summary} https://untrusted.test`));
  expect(await readPortalForwardForAssistant(wake, port)).toBe(portalDiscoveryAssistantInput(forwardedPortalFallback));
});
