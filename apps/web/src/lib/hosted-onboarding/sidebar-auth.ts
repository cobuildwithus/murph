export interface HostedSidebarAuthSnapshot {
  authenticated: boolean;
  label: string | null;
}

export const anonymousHostedSidebarAuthSnapshot: HostedSidebarAuthSnapshot = {
  authenticated: false,
  label: null,
};
