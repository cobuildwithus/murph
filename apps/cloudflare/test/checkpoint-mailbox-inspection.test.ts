import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { upsertAssistantInputEvent, recordHostedMailboxAssistantInputItem } from "@murphai/assistant-engine";
import { collectHostedWorkspaceSnapshotArchivePlan, resolveAssistantStatePaths } from "@murphai/runtime-state/node";
import { hostedWorkspaceSnapshotObjectKey } from "@murphai/hosted-execution/storage-paths";
import { parseHostedWorkspaceSnapshotV2Ref } from "@murphai/hosted-execution/parsers";
import { buildHostedWorkspaceSnapshotV2Aad, buildHostedWorkspaceSnapshotV2FingerprintSha256 as fingerprint,
 encodeHostedWorkspaceSnapshotV2DataKey, wrapHostedWorkspaceSnapshotV2DataKey } from "@murphai/hosted-execution/workspace-snapshot-v2";
import { assessCheckpointRecovery } from "../scripts/checkpoint-recovery-assessment.ts";
import { inspectMailboxSnapshotRecords } from "../scripts/checkpoint-mailbox-inspection.ts";
import { sealRecoveryAssessmentRequest, openRecoveryAssessmentRequest } from "../scripts/checkpoint-recovery-envelope.ts";
import { createEncryptedWorkspaceSnapshotFile } from "../src/workspace-snapshot-local.ts";
import { createTestHostedRuntimeCryptoContext, getTestHostedRuntimeRootKey } from "./hosted-runtime-crypto-fixtures.ts";
import { TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK, TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK,
 TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION, TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM,
 TEST_HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID } from "./hosted-execution-fixtures.ts";
const scratch: string[] = [];
afterEach(async()=>{for(const dir of scratch.splice(0)) await rm(dir,{recursive:true,force:true});});
async function fixture() {
 const root=await mkdtemp(path.join(tmpdir(),"synthetic-mailbox-inspection-"));scratch.push(root);
 const durableRoot=path.join(root,"source"); const vault=path.join(durableRoot,"vault");
 const event=await upsertAssistantInputEvent({vault,event:createAssistantInputEvent({dedupeKey:"fixture",eventId:"fixture",itemId:"blinded-item",laneSeq:"12",messageId:"synthetic-message",occurredAt:"2026-02-01T00:00:00.000Z",receivedAt:"2026-02-01T00:00:00.000Z",text:"PRIVATE_SYNTHETIC_MESSAGE"})});
 await recordHostedMailboxAssistantInputItem({vault,inputId:event.inputId,mailboxItemId:"synthetic-item"});
 const stateRoot=resolveAssistantStatePaths(vault).assistantStateRoot;
 await writeFile(path.join(stateRoot,"hosted-pending-inputs.json"),JSON.stringify({schema:"murph.hosted-pending-assistant-inputs.v2",schemaVersion:2,value:{inputIds:[],backfilled:true,hasImageCompletionCandidate:false,handledBatchCursorInputId:null}}));
 const evidence={schema:"murph.assistant-auto-reply-terminal-evidence.v1",captureId:event.inputId,inputId:event.inputId,groupId:"fixture-group",groupInputIds:[event.inputId],groupCaptureIds:[event.inputId],primaryCaptureId:event.inputId,primaryInputId:event.inputId,recordedAt:"2026-02-01T00:01:00.000Z",providerCleanup:{linqMessageIds:[],queuedAt:null},terminal:{kind:"suppressed",reason:"PRIVATE_SYNTHETIC_REASON"}};
 const evidenceDir=path.join(stateRoot,"auto-reply/evidence");await mkdir(evidenceDir,{recursive:true});
 const evidencePath=path.join(evidenceDir,event.inputId+".json");await writeFile(evidencePath,JSON.stringify(evidence));
 const items=[{mailboxItemId:"synthetic-item",laneSeq:"12",inputId:event.inputId},{mailboxItemId:"synthetic-next",laneSeq:"13",inputId:null}];
 return {root,durableRoot,vault,stateRoot,event,items,evidence,evidencePath};
}
async function hostedFixture() {
 const f=await fixture();const userId="synthetic-recovery-member";const context=await createTestHostedRuntimeCryptoContext(userId);
 const rootKeyId="udrk:runtime:test-root";const rootKey=getTestHostedRuntimeRootKey("runtime");const dataKey=randomBytes(32);
 const snapshotId="synthetic-saved";const objectKey=await hostedWorkspaceSnapshotObjectKey({userId,snapshotId});
 const aad=buildHostedWorkspaceSnapshotV2Aad({userId,snapshotId,objectKey});
 const plan=await collectHostedWorkspaceSnapshotArchivePlan({durableRoot:f.durableRoot,vaultRoot:f.vault});
 const archive=await createEncryptedWorkspaceSnapshotFile({aad,archiveEntries:plan.entries,durableRoot:f.durableRoot,dataKey:encodeHostedWorkspaceSnapshotV2DataKey(dataKey),ivBase64:randomBytes(12).toString("base64url"),outputDir:f.root,maxEncryptedBytes:32*1024*1024});
 const source=parseHostedWorkspaceSnapshotV2Ref({schema:"murph.hosted-workspace-snapshot.v2",userId,snapshotId,objectKey,createdAt:"2026-02-01T00:00:00.000Z",upload:"direct-r2-presigned-put",archive:{...archive,format:"tar"},encryption:{aad,ivBase64:archive.ivBase64,rootKeyId,scheme:"murph.hosted-workspace-snapshot-single-object.v1",wrappedDataKey:await wrapHostedWorkspaceSnapshotV2DataKey({aad,dataKey,rootKey,rootKeyId})}});dataKey.fill(0);
 const request={schema:"murph.checkpoint-mailbox-inspection.v1" as const,userId,expectedWorkspaceVersion:"7",before:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+30*60_000).toISOString(),mailboxInspection:{snapshotFingerprint:fingerprint(source),items:f.items}};
 const privateJwk=JSON.stringify(TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK);
 const env={GITHUB_ACTIONS:"true",GITHUB_REPOSITORY:"cobuildwithus/murph-cloud",GITHUB_REF:"refs/heads/main",RECOVERY_PROTECTED_ENVIRONMENT:"production",RECOVERY_MODE:"assess",RECOVERY_SEALED_REQUEST:sealRecoveryAssessmentRequest(request,TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK),CLOUDFLARE_ACCOUNT_ID:"a".repeat(32),CF_BUNDLES_ENAM_BUCKET:"synthetic-bucket",HOSTED_WEB_CALLBACK_SIGNING_KEY_ID:"test",HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK:privateJwk,HOSTED_R2_PRESIGN_ACCESS_KEY_ID:"synthetic-access",HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY:"synthetic-secret",HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION:TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION,HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM:TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM,HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID:TEST_HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID,HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK:privateJwk,HOSTED_CRYPTO_ENV:"test"};
 let reads=0,change=false,corrupt=false;const operations:string[]=[];
 const fetchImpl:typeof fetch=async(url,init)=>{const target=new URL(String(url));operations.push(init?.method??"GET");expect(init?.method??"GET").toBe(target.pathname.endsWith("/crypto-context/root")?"POST":"GET");
 if(target.origin==="https://www.withmurph.ai") {
 if(target.pathname.endsWith("/crypto-context/root")) return Response.json({schema:"murph.hosted-runtime-crypto-root.v1",userId,domain:"runtime",rootKeyId,envelope:context.envelopes.runtime});
 expect(target.pathname).toBe("/api/internal/hosted-workspace");reads++;
 return Response.json({fetchedAt:new Date().toISOString(),workspace:{userId,version:change&&reads>1?"8":"7",createdAt:source.createdAt,updatedAt:source.createdAt,snapshotRef:source}});}
 expect(target.origin).toBe(`https://${"a".repeat(32)}.r2.cloudflarestorage.com`);expect(target.pathname).toBe("/synthetic-bucket/"+source.objectKey);
 const bytes=await readFile(archive.encryptedFilePath);if(corrupt)bytes[0]^=1;return new Response(bytes);
 };
 return {...f,env,request,privateJwk,operations,fetchImpl,change:()=>{change=true;},corrupt:()=>{corrupt=true;}};
}
it("finds a terminal input missing from pending without changing source files or exposing content",async()=>{
 const f=await fixture();const before=await readFile(f.evidencePath);const result=await inspectMailboxSnapshotRecords({vaultRoot:f.vault,items:f.items,signal:new AbortController().signal});
 expect(result.pendingIndex).toEqual({present:true,schemaVersion:2,backfilled:true,inputCount:0});
 expect(result.items[0]).toMatchObject({eventPresent:true,pendingIndexMembership:false,mappingMatchesItem:true,sourceMatchesLaneSeq:true,terminalKind:"suppressed",completeTerminalEvidence:true});
 expect(result.items[1]).toEqual({laneSeq:"13",inputSelectorPresent:false});
 expect(JSON.stringify(result)).not.toMatch(/PRIVATE_SYNTHETIC|ain_|synthetic-item/);expect(await readFile(f.evidencePath)).toEqual(before);
});
it("distinguishes missing group evidence and a mismatched mapping without acknowledging either",async()=>{
 const f=await fixture();f.evidence.groupInputIds.push("ain_"+"a".repeat(32));await writeFile(f.evidencePath,JSON.stringify(f.evidence));
 const result=await inspectMailboxSnapshotRecords({vaultRoot:f.vault,items:[{...f.items[0]!,mailboxItemId:"different"}],signal:new AbortController().signal});
 expect(result.items[0]).toMatchObject({mappingMatchesItem:false,terminalGroupSize:2,terminalGroupMissingCount:1,completeTerminalEvidence:false});
});
it("fails closed on record size, malformed pending state and excessive terminal group",async()=>{
 const f=await fixture();const p=path.join(f.stateRoot,"hosted-pending-inputs.json");const original=await readFile(p);
 await writeFile(p,"x".repeat(1024*1024+1));await expect(inspectMailboxSnapshotRecords({vaultRoot:f.vault,items:f.items,signal:new AbortController().signal})).rejects.toThrow("inspection_record_limit");
 await writeFile(p,"{}");await expect(inspectMailboxSnapshotRecords({vaultRoot:f.vault,items:f.items,signal:new AbortController().signal})).rejects.toThrow();
 await writeFile(p,original);f.evidence.groupInputIds=Array.from({length:257},(_,i)=>"ain_"+i.toString(16).padStart(32,"0"));await writeFile(f.evidencePath,JSON.stringify(f.evidence));await expect(inspectMailboxSnapshotRecords({vaultRoot:f.vault,items:f.items,signal:new AbortController().signal})).rejects.toThrow("inspection_group_limit");
});
it("runs through authenticated protected assessment with only read operations and removes private scratch",async()=>{
 const f=await hostedFixture();const before=(await readdir(tmpdir())).filter(x=>x.startsWith("murph-checkpoint-inspection-"));const result=await assessCheckpointRecovery(f.env,f.fetchImpl);
 expect(result).toMatchObject({schema:"murph.checkpoint-mailbox-inspection.v1",workspaceVersion:"7",workspaceUnchanged:true,runtimeWoken:false,restorationPerformed:false});expect(f.operations).toEqual(["GET","POST","GET","GET"]);
 expect((await readdir(tmpdir())).filter(x=>x.startsWith("murph-checkpoint-inspection-"))).toEqual(before);expect(JSON.stringify(result)).not.toMatch(/PRIVATE_SYNTHETIC|ain_|synthetic-recovery-member/);
});
it.each(["change","corrupt"] as const)("rejects %s and removes scratch without mutation",async(mode)=>{
 const f=await hostedFixture();f[mode]();const before=(await readdir(tmpdir())).filter(x=>x.startsWith("murph-checkpoint-inspection-"));await expect(assessCheckpointRecovery(f.env,f.fetchImpl)).rejects.toThrow();expect(f.operations).toEqual(mode==="change"?["GET","POST","GET","GET"]:["GET","POST","GET"]);expect((await readdir(tmpdir())).filter(x=>x.startsWith("murph-checkpoint-inspection-"))).toEqual(before);
});
it("rejects invalid selectors, mixed recovery authority, wrong fingerprint and alternate modes",async()=>{
 const f=await hostedFixture();
 for(const mailboxInspection of [{...f.request.mailboxInspection,items:Array(13).fill(f.items[0])},{...f.request.mailboxInspection,items:[{...f.items[0],inputId:"../escape"}]},{...f.request.mailboxInspection,snapshotFingerprint:"bad"}]) {
 const sealed=sealRecoveryAssessmentRequest({...f.request,mailboxInspection},TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK);expect(()=>openRecoveryAssessmentRequest(sealed,f.privateJwk)).toThrow();}
 const legacy=sealRecoveryAssessmentRequest({...f.request,schema:"murph.checkpoint-recovery-assessment.v1"},TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK);expect(()=>openRecoveryAssessmentRequest(legacy,f.privateJwk)).toThrow();
 const missing=sealRecoveryAssessmentRequest({...f.request,mailboxInspection:undefined},TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK);expect(()=>openRecoveryAssessmentRequest(missing,f.privateJwk)).toThrow();
 const mixed=sealRecoveryAssessmentRequest({...f.request,partialRecovery:{timezone:"UTC",completedOnboarding:true}},TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK);expect(()=>openRecoveryAssessmentRequest(mixed,f.privateJwk)).toThrow();
 await expect(assessCheckpointRecovery({...f.env,RECOVERY_MODE:"validate"},f.fetchImpl)).rejects.toThrow("invalid_recovery_mode");expect(f.operations).toEqual([]);
 const wrong=sealRecoveryAssessmentRequest({...f.request,mailboxInspection:{...f.request.mailboxInspection,snapshotFingerprint:"0".repeat(64)}},TEST_AUTOMATION_RECIPIENT_PUBLIC_JWK);await expect(assessCheckpointRecovery({...f.env,RECOVERY_SEALED_REQUEST:wrong},f.fetchImpl)).rejects.toThrow("recovery_workspace_changed");expect(f.operations).toEqual(["GET"]);
});
function createAssistantInputEvent(input: {
  actorIsSelf?: boolean;
  dedupeKey: string;
  eventId: string;
  itemId: string;
  lane?: "conversation" | "system";
  laneSeq: string;
  messageId: string;
  occurredAt: string;
  payloadSchema?: string;
  receivedAt: string;
  replyTarget?: "linq" | "telegram" | null;
  source?: "linq" | "telegram";
  text: string;
  wakeSchema?: string;
}) {
  const source = input.source ?? "linq";
  const replyTarget = input.replyTarget === null
    ? null
    : {
        channel: input.replyTarget ?? source,
        messageId: input.messageId,
        threadId: "thread_1",
      };

  return {
    content: {
      text: input.text,
      transcriptText: input.text,
      userMessageContent: [
        {
          text: input.text,
          type: "text" as const,
        },
      ],
    },
    conversation: {
      accountId: "acct_1",
      actorId: "actor_1",
      actorIsSelf: input.actorIsSelf ?? false,
      source,
      threadId: "thread_1",
      threadIsDirect: true,
    },
    occurredAt: input.occurredAt,
    receivedAt: input.receivedAt,
    replyTarget,
    sourceMetadata: source === "linq"
      ? {
          externalThreadRouteAuthorityPresent: false,
          kind: "linq" as const,
          partCount: 1,
          reactionEligible: false,
          replyToMessageId: null,
          service: null,
        }
      : null,
    sourceRef: {
      dedupeKey: input.dedupeKey,
      eventId: input.eventId,
      itemId: input.itemId,
      kind: "hosted-mailbox" as const,
      lane: input.lane ?? "conversation",
      laneSeq: input.laneSeq,
      payloadSchema: input.payloadSchema ?? "murph.hosted-mailbox-payload.v1",
      payloadSource: "inline" as const,
      source: "hosted-mailbox" as const,
      wakeSchema: input.wakeSchema ?? "murph.hosted-execution-wake.v1",
    },
  };
}
