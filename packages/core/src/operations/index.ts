export {
  acquireCanonicalResourceLock,
  CANONICAL_RESOURCE_LOCK_DIRECTORY,
  CANONICAL_RESOURCE_LOCK_METADATA_BASENAME,
  canonicalLogicalResource,
  canonicalPathResource,
  dedupeCanonicalResources,
  isCanonicalResourceLockScopeActive,
  withCanonicalResourceLocks,
} from "./canonical-resource-lock.ts";
export type {
  CanonicalMutationResource,
  CanonicalResourceLockHandle,
  CanonicalResourceLockMetadata,
} from "./canonical-resource-lock.ts";
export {
  acquireCanonicalWriteLock,
  CANONICAL_WRITE_LOCK_DIRECTORY,
  CANONICAL_WRITE_LOCK_METADATA_PATH,
  inspectCanonicalWriteLock,
  withCanonicalWriteLockScope,
} from "./canonical-write-lock.ts";
export type {
  CanonicalWriteLockHandle,
  CanonicalWriteLockInspection,
  CanonicalWriteLockMetadata,
} from "./canonical-write-lock.ts";
export {
  isProtectedCanonicalPath,
  listProtectedCanonicalPaths,
  readRecoverableStoredWriteOperation,
  isTerminalWriteOperationStatus,
  listWriteOperationMetadataPaths,
  readStoredWriteOperation,
  runCanonicalWrite,
  WriteBatch,
  WRITE_OPERATION_DIRECTORY,
  WRITE_OPERATION_SCHEMA_VERSION,
} from "./write-batch.ts";
export type { RecoverableStoredWriteOperation } from "./write-batch.ts";
