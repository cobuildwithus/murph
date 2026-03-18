import { buildAuditRecord, resolveAuditShardPath } from "../audit.js";
import { WriteBatch } from "../operations/write-batch.js";

type AuditRecordInput = Parameters<typeof buildAuditRecord>[0];
type AuditAction = AuditRecordInput["action"];
type AuditChangeList = NonNullable<AuditRecordInput["changes"]>;
type AuditTargetIdList = NonNullable<AuditRecordInput["targetIds"]>;

interface WriteBankRecordWithAuditInput {
  vaultRoot: string;
  operationType: string;
  batchSummary: string;
  relativePath: string;
  markdown: string;
  auditAction: AuditAction;
  auditCommandName: string;
  auditSummary: string;
  auditTargetIds: AuditTargetIdList;
  auditChanges: AuditChangeList;
}

export async function writeBankRecordWithAudit({
  vaultRoot,
  operationType,
  batchSummary,
  relativePath,
  markdown,
  auditAction,
  auditCommandName,
  auditSummary,
  auditTargetIds,
  auditChanges,
}: WriteBankRecordWithAuditInput): Promise<string> {
  const batch = await WriteBatch.create({
    vaultRoot,
    operationType,
    summary: batchSummary,
  });

  await batch.stageTextWrite(relativePath, markdown);

  const auditRecord = buildAuditRecord({
    action: auditAction,
    commandName: auditCommandName,
    summary: auditSummary,
    targetIds: auditTargetIds,
    changes: auditChanges,
  });
  const auditPath = resolveAuditShardPath(auditRecord.occurredAt);

  await batch.stageJsonlAppend(auditPath, `${JSON.stringify(auditRecord)}\n`);
  await batch.commit();

  return auditPath;
}
