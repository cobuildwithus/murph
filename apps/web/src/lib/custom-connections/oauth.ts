import "server-only";

import * as z from "@murphai/contracts/zod-runtime";
import { randomBytes } from "node:crypto";
import {
  auth, discoverOAuthProtectedResourceMetadata, validateAuthorizationResponseIssuer,
  type OAuthClientProvider, type OAuthDiscoveryState, type OAuthClientMetadata,
  type StoredOAuthClientInformation, type StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import { connectionUrl, guardedConnectionFetch, type ConnectionFetch } from "./guarded-fetch";
import { ConnectionError } from "./errors";

export interface ConnectionCredentials {
  discovery: OAuthDiscoveryState;
  client?: StoredOAuthClientInformation;
  tokens?: StoredOAuthTokens;
  expiresAt?: number;
}
export interface PendingAuthorization extends ConnectionCredentials {
  verifier: string;
}
export const WEB_ORIGIN = "https://www.withmurph.ai";
export function connectionRedirectUri(id: string): string {
  return `${WEB_ORIGIN}/api/settings/custom-connections/callback/${encodeURIComponent(id)}`;
}
export function connectionClientMetadata(id: string): OAuthClientMetadata {
  return {
    client_name: "Murph", redirect_uris: [connectionRedirectUri(id)],
    grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

export function validateDiscovery(state: OAuthDiscoveryState, resource: string): void {
  const metadata = state.authorizationServerMetadata;
  // Without RFC 9207 issuer identification, a hostile authorization server can relay
  // the member to an honest one and receive its code: per-connection return
  // addresses don't prevent that, since the client document is public.
  if (!state.resourceMetadata || !metadata || metadata.issuer !== state.authorizationServerUrl
    || metadata.authorization_response_iss_parameter_supported !== true
    || !metadata.code_challenge_methods_supported?.includes("S256")
    || !state.resourceMetadata.authorization_servers?.includes(metadata.issuer)
    || (!metadata.client_id_metadata_document_supported && !metadata.registration_endpoint)) {
    throw new ConnectionError("sign_in_unsupported");
  }
  if (connectionUrl(state.resourceMetadata.resource).href !== resource) throw new ConnectionError("sign_in_unsupported");
  for (const endpoint of [metadata.issuer, metadata.authorization_endpoint, metadata.token_endpoint, metadata.registration_endpoint, revocationEndpoint(state)]) {
    if (endpoint) connectionUrl(endpoint);
  }
}

/** The provider owns credential destinations; guarded fetch owns network safety. */
export class ConnectionOAuthProvider implements OAuthClientProvider {
  readonly redirectUrl: string;
  readonly clientMetadataUrl: string;
  readonly clientMetadata: OAuthClientMetadata;
  readonly stateValue = randomBytes(32).toString("base64url");
  authorizationUrl?: URL;
  private discovery?: OAuthDiscoveryState;
  private client?: StoredOAuthClientInformation;
  private savedTokens?: StoredOAuthTokens;
  private verifier?: string;
  readonly fetch: ConnectionFetch;

  constructor(readonly id: string, readonly resource: string, private readonly options: {
    credentials?: ConnectionCredentials;
    pending?: PendingAuthorization;
    saveTokens?: (value: ConnectionCredentials) => Promise<void>;
    redirect?: (state: string, pending: PendingAuthorization) => Promise<void>;
    fetch?: ConnectionFetch;
  } = {}) {
    this.redirectUrl = connectionRedirectUri(id);
    this.clientMetadataUrl = `${WEB_ORIGIN}/oauth/mcp-client/${encodeURIComponent(id)}`;
    this.clientMetadata = connectionClientMetadata(id);
    const saved = options.pending ?? options.credentials;
    if (saved) {
      validateDiscovery(saved.discovery, resource);
      this.discovery = saved.discovery;
      this.client = saved.client;
      this.savedTokens = saved.tokens;
    }
    this.verifier = options.pending?.verifier;
    this.fetch = async (input, init = {}) => {
      const destination = connectionUrl(String(input)).href;
      const headers = new Headers(init.headers);
      const metadata = this.discovery?.authorizationServerMetadata;
      const isResource = destination === resource;
      const isToken = matchesEndpoint(metadata?.token_endpoint, destination);
      const isRegistration = matchesEndpoint(metadata?.registration_endpoint, destination);
      // Callback/refresh are frozen: even credential-free rediscovery is forbidden.
      if (saved && !isResource && !isToken) throw new ConnectionError("sign_in_unsupported");
      if (headers.has("cookie")) throw new ConnectionError("sign_in_unsupported");
      if (headers.has("authorization") && !isResource && !isToken) throw new ConnectionError("sign_in_unsupported");
      if (init.body && !isResource && !isToken && !isRegistration) throw new ConnectionError("sign_in_unsupported");
      const response = await (options.fetch ?? guardedConnectionFetch)(destination, init);
      if (!isToken && !isRegistration) return response;
      return this.credentialResponse(response, Boolean(isToken));
    };
  }
  private async credentialResponse(response: Response, isToken: boolean): Promise<Response> {
    // SDK error parsers may include provider bodies in errors and refresh logs.
    // Admit only validated credential fields; never hand them an error body.
    if (!response.ok) {
      await response.body?.cancel();
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    }
    const schema = isToken ? z.object({
      access_token: z.string().min(1).max(16384), token_type: z.string().regex(/^Bearer$/i),
      refresh_token: z.string().max(16384).optional(), expires_in: z.number().nonnegative().optional(), scope: z.string().max(4096).optional(),
    }) : z.object({ redirect_uris: z.array(z.literal(this.redirectUrl)).length(1),
      grant_types: z.array(z.string()).optional(), response_types: z.array(z.string()).optional(),
      client_id: z.string().min(1).max(2048), client_secret: z.string().max(16384).optional(),
      client_id_issued_at: z.number().optional(), client_secret_expires_at: z.number().optional(),
      token_endpoint_auth_method: z.enum(["none", "client_secret_basic", "client_secret_post"]).optional(),
    });
    const parsed = schema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new ConnectionError("sign_in_unsupported");
    return Response.json(parsed.data);
  }
  state() { return this.stateValue; }
  discoveryState() { return this.discovery; }
  saveDiscoveryState(state: OAuthDiscoveryState) {
    validateDiscovery(state, this.resource);
    if (this.discovery && JSON.stringify(this.discovery) !== JSON.stringify(state)) throw new ConnectionError("sign_in_unsupported");
    // SDK 2.4 augments requested scope with offline_access. The product contract
    // requests only the challenge scope or the resource's declared scopes.
    if (state.authorizationServerMetadata?.scopes_supported) {
      state.authorizationServerMetadata.scopes_supported = state.authorizationServerMetadata.scopes_supported.filter((scope) => scope !== "offline_access");
    }
    this.discovery = state;
  }
  clientInformation(context?: { issuer: string }) {
    this.assertIssuer(context?.issuer);
    return this.client;
  }
  saveClientInformation(client: StoredOAuthClientInformation, context?: { issuer: string }) {
    this.assertIssuer(context?.issuer);
    this.client = client;
  }
  tokens(context?: { issuer: string }) {
    this.assertIssuer(context?.issuer);
    return this.savedTokens;
  }
  async saveTokens(tokens: StoredOAuthTokens, context?: { issuer: string }) {
    this.assertIssuer(context?.issuer);
    if (!this.discovery || !this.options.saveTokens) throw new ConnectionError("needs_sign_in");
    await this.options.saveTokens({ discovery: this.discovery, client: this.client, tokens,
      expiresAt: tokens.expires_in === undefined ? undefined : Date.now() + tokens.expires_in * 1000 });
    // A rejected durable save must never make the successor usable by the SDK.
    this.savedTokens = tokens;
  }
  /** The SDK would retry a failed grant with the same code or refresh token; one try, then sign in again. */
  invalidateCredentials(): never { throw new ConnectionError("needs_sign_in"); }
  saveCodeVerifier(verifier: string) { this.verifier = verifier; }
  codeVerifier() {
    if (!this.verifier) throw new ConnectionError("sign_in_unsupported");
    return this.verifier;
  }
  async validateResourceURL(server: string | URL, resource?: string) {
    if (connectionUrl(String(server)).href !== this.resource || (resource && connectionUrl(resource).href !== this.resource)) {
      throw new ConnectionError("sign_in_unsupported");
    }
    return new URL(this.resource);
  }
  async redirectToAuthorization(url: URL) {
    if (!this.discovery || !this.options.redirect) throw new ConnectionError("needs_sign_in");
    const endpoint = new URL(this.discovery.authorizationServerMetadata!.authorization_endpoint!);
    if (url.origin !== endpoint.origin || url.pathname !== endpoint.pathname || url.searchParams.get("state") !== this.stateValue) {
      throw new ConnectionError("sign_in_unsupported");
    }
    await this.options.redirect(this.stateValue, { discovery: this.discovery, client: this.client, verifier: this.codeVerifier() });
    this.authorizationUrl = url;
  }
  private assertIssuer(issuer?: string) {
    if (issuer && issuer !== this.discovery?.authorizationServerMetadata?.issuer) throw new ConnectionError("sign_in_unsupported");
  }
}

/**
 * Starts sign-in for a server that publishes protected-resource metadata, even when it also answers without
 * sign-in: its tools for the member's own account only work signed in. False when the server publishes none,
 * or sign-in can't start here (for example no RFC 9207 support), so the caller connects without it.
 */
export async function startOfferedAuthorization(provider: ConnectionOAuthProvider): Promise<boolean> {
  try {
    const metadata = await discoverOAuthProtectedResourceMetadata(provider.resource, undefined, provider.fetch);
    if (!metadata.authorization_servers?.length) return false;
    return await auth(provider, { serverUrl: provider.resource, fetchFn: provider.fetch }) === "REDIRECT"
      && provider.authorizationUrl !== undefined;
  } catch {
    return provider.authorizationUrl !== undefined;
  }
}

export async function completeConnectionAuthorization(provider: ConnectionOAuthProvider, code: string, iss?: string) {
  const metadata = provider.discoveryState()?.authorizationServerMetadata;
  // validateDiscovery admits only servers that send iss, so it is always required here.
  validateAuthorizationResponseIssuer({ iss, expectedIssuer: metadata?.issuer, issParameterSupported: true });
  return auth(provider, { serverUrl: provider.resource, authorizationCode: code, iss, fetchFn: provider.fetch });
}

export function revocationEndpoint(state: OAuthDiscoveryState): string | undefined {
  const metadata = state.authorizationServerMetadata;
  return metadata && "revocation_endpoint" in metadata && typeof metadata.revocation_endpoint === "string"
    ? metadata.revocation_endpoint : undefined;
}

function matchesEndpoint(endpoint: string | undefined, destination: string): boolean {
  return endpoint !== undefined && connectionUrl(endpoint).href === destination;
}
