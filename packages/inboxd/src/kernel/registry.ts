import type { BaseConnector, PollConnector, WebhookConnector } from "../connectors/types.ts";

export interface ConnectorRegistry {
  add(connector: BaseConnector): void;
  get(id: string): BaseConnector | null;
  listBySource(source: string): BaseConnector[];
  requirePoll(id: string): PollConnector;
  requireWebhook(id: string): WebhookConnector;
  list(): BaseConnector[];
}

export function createConnectorRegistry(connectors: Iterable<BaseConnector> = []): ConnectorRegistry {
  const registry = new Map<string, BaseConnector>();

  for (const connector of connectors) {
    registry.set(resolveRegistrationKey(registry, connector), connector);
  }

  return {
    add(connector) {
      registry.set(resolveRegistrationKey(registry, connector), connector);
    },
    get(id) {
      return resolveConnector(registry, id) ?? null;
    },
    listBySource(source) {
      return listConnectorsBySource(registry, source);
    },
    requirePoll(id) {
      return requireConnectorKind(registry, id, "poll");
    },
    requireWebhook(id) {
      return requireConnectorKind(registry, id, "webhook");
    },
    list() {
      return Array.from(registry.values());
    },
  };
}

function requireConnectorKind(
  registry: Map<string, BaseConnector>,
  id: string,
  kind: "poll",
): PollConnector;
function requireConnectorKind(
  registry: Map<string, BaseConnector>,
  id: string,
  kind: "webhook",
): WebhookConnector;
function requireConnectorKind(
  registry: Map<string, BaseConnector>,
  id: string,
  kind: BaseConnector["kind"],
): PollConnector | WebhookConnector {
  const lookup = lookupConnector(registry, id);

  if (lookup.ambiguous) {
    throw new TypeError(`Multiple connectors registered for source: ${id}. Use a connector id.`);
  }

  if (!lookup.connector || lookup.connector.kind !== kind) {
    const label = kind === "poll" ? "Poll" : "Webhook";
    throw new TypeError(`${label} connector not registered for ${lookup.scope}: ${id}`);
  }

  return lookup.connector as PollConnector | WebhookConnector;
}

function resolveConnector(registry: Map<string, BaseConnector>, id: string): BaseConnector | undefined {
  return lookupConnector(registry, id).connector;
}

function lookupConnector(
  registry: Map<string, BaseConnector>,
  id: string,
): { connector: BaseConnector | undefined; ambiguous: boolean; scope: "id" | "source" } {
  const direct = registry.get(id);

  if (direct) {
    return {
      connector: direct,
      ambiguous: false,
      scope: hasExplicitConnectorId(direct) ? "id" : "source",
    };
  }

  const matches = listConnectorsBySource(registry, id);
  return {
    connector: matches.length === 1 ? matches[0] : undefined,
    ambiguous: matches.length > 1,
    scope: "source",
  };
}

function listConnectorsBySource(
  registry: Map<string, BaseConnector>,
  source: string,
): BaseConnector[] {
  return Array.from(registry.values()).filter((connector) => connector.source === source);
}

function resolveRegistrationKey(registry: Map<string, BaseConnector>, connector: BaseConnector): string {
  const id = typeof connector.id === "string" ? connector.id.trim() : "";

  if (id) {
    return id;
  }

  const source = typeof connector.source === "string" ? connector.source.trim() : "";

  if (!source) {
    throw new TypeError("Connector id must be a non-empty string.");
  }

  if (registry.has(source)) {
    throw new TypeError(`Connector id is required when multiple connectors share source: ${source}`);
  }

  return source;
}

function hasExplicitConnectorId(connector: BaseConnector): boolean {
  return typeof connector.id === "string" && connector.id.trim().length > 0;
}
