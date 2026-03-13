import type { BaseConnector, PollConnector, WebhookConnector } from "../connectors/types.js";

export interface ConnectorRegistry {
  add(connector: BaseConnector): void;
  get(source: string): BaseConnector | null;
  requirePoll(source: string): PollConnector;
  requireWebhook(source: string): WebhookConnector;
  list(): BaseConnector[];
}

export function createConnectorRegistry(connectors: Iterable<BaseConnector> = []): ConnectorRegistry {
  const registry = new Map<string, BaseConnector>();

  for (const connector of connectors) {
    registry.set(connector.source, connector);
  }

  return {
    add(connector) {
      registry.set(connector.source, connector);
    },
    get(source) {
      return registry.get(source) ?? null;
    },
    requirePoll(source) {
      return requireConnectorKind(registry.get(source), source, "poll");
    },
    requireWebhook(source) {
      return requireConnectorKind(registry.get(source), source, "webhook");
    },
    list() {
      return Array.from(registry.values());
    },
  };
}

function requireConnectorKind(
  connector: BaseConnector | undefined,
  source: string,
  kind: "poll",
): PollConnector;
function requireConnectorKind(
  connector: BaseConnector | undefined,
  source: string,
  kind: "webhook",
): WebhookConnector;
function requireConnectorKind(
  connector: BaseConnector | undefined,
  source: string,
  kind: BaseConnector["kind"],
): PollConnector | WebhookConnector {
  if (!connector || connector.kind !== kind) {
    const label = kind === "poll" ? "Poll" : "Webhook";
    throw new TypeError(`${label} connector not registered for source: ${source}`);
  }

  return connector as PollConnector | WebhookConnector;
}
