import type { ParseRequest, ProviderRunResult } from "./parse.js";

export interface ProviderAvailability {
  available: boolean;
  reason: string;
  executablePath?: string | null;
  details?: Record<string, unknown>;
}

export interface ParserProvider {
  id: string;
  discover(): Promise<ProviderAvailability>;
  supports(request: ParseRequest): boolean | Promise<boolean>;
  run(request: ParseRequest): Promise<ProviderRunResult>;
}

export interface ProviderSelection {
  provider: ParserProvider;
  availability: ProviderAvailability;
}
