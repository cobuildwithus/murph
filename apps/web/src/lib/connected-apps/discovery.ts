import "server-only";

import {
  getHostedConnectedAppsCustomAuthExecution,
  HOSTED_CONNECTED_APPS_SERVICE_TOOLS,
} from "./config";

// Catalog connection advice describes the provider's account model, not Murph's
// execution policy. Derive the exception from the same exact tools execution uses.
export function reconcileHostedConnectedAppsDiscovery(result: unknown): unknown {
  if (!isRecord(result) || !isRecord(result.tool_schemas)) return result;
  const schemas = result.tool_schemas;
  const serviceTools = Object.entries(HOSTED_CONNECTED_APPS_SERVICE_TOOLS)
    .flatMap(([toolkit, { enable }]) => enable
      .filter((slug) => Object.hasOwn(schemas, slug))
      .map((toolSlug) => {
        let configured = true;
        try {
          getHostedConnectedAppsCustomAuthExecution(toolSlug);
        } catch {
          configured = false;
        }
        return {
          tool_slug: toolSlug,
          toolkit,
          member_connection_required: false,
          configuration_status: configured ? "ready" : "unavailable",
          status_message: configured
            ? "Murph provides this service. Execute without a member account; no connection is needed. Provider execution can still fail."
            : "Murph's service configuration is unavailable. A member account connection will not fix it.",
        };
      }));
  if (serviceTools.length === 0) return result;
  const serviceToolkits = new Set(serviceTools.map((tool) => tool.toolkit));
  return {
    ...result,
    service_tools: serviceTools,
    toolkit_connection_statuses: Array.isArray(result.toolkit_connection_statuses)
      ? result.toolkit_connection_statuses.map((status) => {
        if (!isRecord(status) || !serviceToolkits.has(String(status.toolkit))) return status;
        return {
          toolkit: status.toolkit,
          member_connection_required: false,
          enabled_tool_slugs: serviceTools
            .filter((tool) => tool.toolkit === status.toolkit)
            .map((tool) => tool.tool_slug),
          status_message: "Use service_tools for the listed Murph-provided actions. They need no member connection. This does not enable other actions in this toolkit.",
        };
      })
      : result.toolkit_connection_statuses,
    next_steps_guidance: [
      "For exact actions listed in service_tools, follow their configuration_status and execute without an account when ready. Never ask the member to connect these services.",
      "For other apps, preserve toolkit_connection_statuses, select the member's connected account, and use Murph's connection flow when needed. Existing approval requirements still apply.",
    ],
    results: Array.isArray(result.results)
      ? result.results.map((query) => {
        if (!isRecord(query) || !Array.isArray(query.toolkits)
          || !query.toolkits.some((toolkit) => serviceToolkits.has(String(toolkit)))) return query;
        // Cached workflow prose can repeat the same inapplicable connection step.
        const { execution_guidance, recommended_plan_steps, known_pitfalls, ...discovery } = query;
        void execution_guidance;
        void recommended_plan_steps;
        void known_pitfalls;
        return discovery;
      })
      : result.results,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
