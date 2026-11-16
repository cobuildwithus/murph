import type { HostedCustomConnectionManifestEntry } from '@murphai/hosted-execution'

export function buildCustomConnectionsThreadConfig(manifest: readonly HostedCustomConnectionManifestEntry[]) {
  if (manifest.length === 0) return null
  return {
    mcp_servers: Object.fromEntries(manifest.map(connection => [connection.slug, {
      url: `http://connections.worker/v1/${connection.id}/${connection.generation}/${connection.catalog}/mcp`,
      required: false,
      default_tools_approval_mode: 'approve',
      startup_timeout_sec: 10,
      tool_timeout_sec: 35,
    }])),
  }
}
