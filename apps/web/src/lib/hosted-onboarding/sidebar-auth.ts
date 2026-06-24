export interface HostedSidebarAuthSnapshot {
  authenticated: boolean;
  label: string | null;
  requiresDashboardRecovery: boolean;
}

export const anonymousHostedSidebarAuthSnapshot: HostedSidebarAuthSnapshot = {
  authenticated: false,
  label: null,
  requiresDashboardRecovery: false,
};
