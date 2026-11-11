import {
  assertBrowserMutationOrigin,
  requireAuthenticatedHostedUser,
  type AuthenticatedHostedUser,
} from "./auth";
import {
  createHostedDeviceSyncControlPlaneContext,
  type HostedDeviceSyncControlPlaneContext,
} from "./control-plane-context";

export class HostedDeviceSyncControlPlane {
  readonly request: Request;
  readonly env: HostedDeviceSyncControlPlaneContext["env"];
  readonly store: HostedDeviceSyncControlPlaneContext["store"];
  readonly publicIngressBaseUrl: string;
  readonly publicIngressBaseUrlSource:
    HostedDeviceSyncControlPlaneContext["publicIngressBaseUrlSource"];
  readonly allowedReturnOrigins: string[];
  private authenticatedUserPromise: Promise<AuthenticatedHostedUser> | null = null;

  constructor(request: Request) {
    this.request = request;
    const context = createHostedDeviceSyncControlPlaneContext(request);
    this.env = context.env;
    this.store = context.store;
    this.publicIngressBaseUrl = context.publicIngressBaseUrl;
    this.publicIngressBaseUrlSource = context.publicIngressBaseUrlSource;
    this.allowedReturnOrigins = context.allowedReturnOrigins;
  }

  requireAuthenticatedUser(): Promise<AuthenticatedHostedUser> {
    if (!this.authenticatedUserPromise) {
      this.authenticatedUserPromise = requireAuthenticatedHostedUser(this.request, this.env, {
        nonceStore: this.store,
      });
    }

    return this.authenticatedUserPromise;
  }

  assertBrowserMutationOrigin(): void {
    assertBrowserMutationOrigin(this.request, {
      ...this.env,
      allowedReturnOrigins: this.allowedReturnOrigins,
    });
  }
}

export function createHostedDeviceSyncControlPlane(request: Request): HostedDeviceSyncControlPlane {
  return new HostedDeviceSyncControlPlane(request);
}
