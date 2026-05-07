export {
  acquireCanonicalResourceLock,
  CANONICAL_RESOURCE_LOCK_DIRECTORY,
  CANONICAL_RESOURCE_LOCK_METADATA_BASENAME,
  canonicalLogicalResource,
  canonicalPathResource,
  canonicalPathResourceForVault,
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
  HOSTED_CANONICAL_WRITE_RECEIPT_DIRECTORY_ENV,
  HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
  listProtectedCanonicalPaths,
  readRecoverableStoredWriteOperation,
  isTerminalWriteOperationStatus,
  listWriteOperationMetadataPaths,
  applyHostedCanonicalWriteReceipt,
  readStoredWriteOperation,
  resolveHostedCanonicalWritePayloadFilePath,
  runCanonicalWrite,
  withHostedCanonicalWritePort,
  WriteBatch,
  WRITE_OPERATION_DIRECTORY,
  WRITE_OPERATION_SCHEMA_VERSION,
} from "./write-batch.ts";
export type {
  HostedCanonicalWritePayload,
  HostedCanonicalWritePort,
  HostedCanonicalWritePersistenceInput,
  HostedCanonicalWriteReceipt,
  HostedCanonicalWriteReceiptAction,
  HostedCanonicalWriteReceiptContentRef,
  RecoverableStoredWriteOperation,
} from "./write-batch.ts";
