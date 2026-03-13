import type { ParseRequest, ProviderRunResult } from "./parse.js";

export type ParserProviderLocality = "local" | "remote";
export type ParserProviderOpenness = "open_source" | "open_weights" | "closed";
export type ParserProviderRuntime = "cli" | "local_http" | "node" | "python" | "remote_api";

export interface ProviderAvailability {
  available: boolean;
  reason: string;
  executablePath?: string | null;
  details?: Record<string, unknown>;
}

export interface ParserProvider {
  id: string;
  locality: ParserProviderLocality;
  openness: ParserProviderOpenness;
  runtime: ParserProviderRuntime;
  priority: number;
  discover(): Promise<ProviderAvailability>;
  supports(request: ParseRequest): boolean | Promise<boolean>;
  run(request: ParseRequest): Promise<ProviderRunResult>;
}

export interface ProviderSelection {
  provider: ParserProvider;
  availability: ProviderAvailability;
  score: number;
}
