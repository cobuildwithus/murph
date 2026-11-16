import type { HostedCustomConnectionManifestEntry } from '@murphai/hosted-execution'

export function buildCustomConnectionsThreadConfig(manifest: readonly HostedCustomConnectionManifestEntry[]) {
  return {
    // An explicit empty map also clears ambient config on restricted launches.
    mcp_servers: Object.fromEntries(manifest.map(connection => [connection.slug, {
      url: `http://connections.worker/v1/${connection.id}/${connection.generation}/${connection.catalog}/mcp`,
      required: false,
      default_tools_approval_mode: 'approve',
      startup_timeout_sec: 10,
      tool_timeout_sec: 60,
    }])),
  }
}
