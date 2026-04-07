export interface QueryProjectionStatus {
  dbPath: string;
  exists: boolean;
  schemaVersion: string | null;
  builtAt: string | null;
  entityCount: number;
  searchDocumentCount: number;
  fresh: boolean;
}

export interface RebuildQueryProjectionResult extends QueryProjectionStatus {
  rebuilt: true;
}
