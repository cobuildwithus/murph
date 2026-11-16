import { z } from "zod";

export const HOSTED_CUSTOM_CONNECTIONS_MANIFEST_PATH = "/api/internal/custom-connections/manifest";

// Only nonsecret mount identity crosses the Web/runtime boundary.
export const hostedCustomConnectionManifestEntrySchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
  slug: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/u),
  generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  catalog: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
}).strip();

export const hostedCustomConnectionsManifestSchema = z.object({
  connections: z.array(hostedCustomConnectionManifestEntrySchema).max(100),
}).strip().refine(({ connections }) =>
  new Set(connections.map(entry => entry.id)).size === connections.length
  && new Set(connections.map(entry => entry.slug)).size === connections.length,
);

export type HostedCustomConnectionManifestEntry = z.infer<typeof hostedCustomConnectionManifestEntrySchema>;

export interface HostedCustomConnectionsPort {
  readManifest(): Promise<readonly HostedCustomConnectionManifestEntry[]>;
}
