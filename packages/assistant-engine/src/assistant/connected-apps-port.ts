import type {
  HostedConnectedAppsRequest,
  HostedConnectedAppsResponse,
} from '@murphai/hosted-execution/connected-apps'

export interface AssistantConnectedAppsPort {
  request(
    request: HostedConnectedAppsRequest,
    options?: {
      signal?: AbortSignal | null
    },
  ): Promise<HostedConnectedAppsResponse>
}
