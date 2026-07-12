export const DEFAULT_STATEMENT_TIMEOUT_MS: number;
export const MAX_CANDIDATE_IDS: number;
export const SEARCH_TEXT_MAX_LENGTH: number;

export interface AuditOptions {
  candidateLimit?: number;
  statementTimeoutMs?: number;
}

export interface ParsedAuditOptions {
  candidateLimit: number;
  statementTimeoutMs: number;
  help: boolean;
}

export function parseArgs(argv: string[]): ParsedAuditOptions;
export function readOnlySql(body: string, statementTimeoutMs: number): string;
export function buildSchemaAuditSql(statementTimeoutMs?: number): string;
export function buildDataAuditSql(options?: {
  includeProductTests?: boolean;
  statementTimeoutMs?: number;
}): string;
export function buildCandidateAuditSql(options: {
  candidateLimit: number;
  statementTimeoutMs?: number;
}): string;
export function extractJsonPayload(psqlOutput: string): Record<string, unknown>;
export function schemaAllowsDataAudit(schemaAudit: unknown): boolean;
export function productTestsCanBeAudited(schemaAudit: unknown): boolean;
export function runAudit(options?: AuditOptions & {
  dbUrl?: string;
  executeSql?: (dbUrl: string, sql: string) => string;
}): Record<string, unknown>;
