import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createHostedLinqDeliveryIdempotencyLookupKey } from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import { getPrisma } from "@/src/lib/prisma";
import { readGame, readGameChatState, runGameCommand } from "@/src/lib/game/service";
import { gameLocalDate } from "@/src/lib/game/time";
import type { GameCommand } from "@/src/lib/game/contract";
const delivery = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/src/lib/game/chat-delivery", () => ({ deliverGameChangeProposal: delivery }));
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Game changes proof needs an isolated local test database.");
const members: string[] = [];
async function run(actorMemberId: string, command: GameCommand, options: { chatContainerMemberId?: string; now?: Date; beforeMutationTx?: () => Promise<void> } = {}) {
  return runGameCommand({ actorMemberId, command, ...options });
}
async function setup() {
  const a = `game_a_${randomUUID()}`, b = `game_b_${randomUUID()}`, room = `game_room_${randomUUID()}`;
  members.push(a,b,room);
  await getPrisma().hostedMember.createMany({ data: [a,b,room].map((id) => ({ id, billingStatus: "not_started" })) });
  await run(a,{type:"setProfile", firstName:"Riley", timeZone:"America/New_York"});
  await run(b,{type:"setProfile", firstName:"Jordan", timeZone:"America/New_York"});
  const gameId = randomUUID();
  const created = await run(a,{type:"createGame",gameId,inviteeFirstName:"Private nickname",terms:{tasks:[{seat:0,text:"Read"},{seat:1,text:"Walk"}],schedule:{days:[0,1,2,3,4]},stakes:[{kind:"winner_gets",item:"Breakfast"}]}});
  if (!created.ok || !created.game?.inviteToken) throw new Error("Fixture create failed");
  const joined = await run(b,{type:"join",token:created.game.inviteToken,termsVersion:1,timeZone:"America/New_York"});
  if (!joined.ok) throw new Error("Fixture join failed");
  await getPrisma().game.update({where:{id:gameId},data:{chatContainerMemberId:room}});
  return {a,b,room,gameId};
}
const fence = async () => {};

describe.skipIf(!enabled)("weekly game change serialization against PostgreSQL", () => {
  afterAll(async () => { await getPrisma().hostedMember.deleteMany({where:{id:{in:members}}}); });
  it("needs the other player in the bound chat and applies once across retries", async () => {
    const {a,b,room,gameId}=await setup(); const proposalId=randomUUID();
    const proposed=await run(a,{type:"proposeChange",gameId,proposalId,expectedTermsVersion:1,change:{kind:"edit",schedule:{days:[5,6]},lengthDays:14}});
    expect(proposed.ok).toBe(true);
    expect((await readGame(gameId,a))?.terms.schedule).toEqual({days:[0,1,2,3,4]});
    const command={type:"respondChange" as const,gameId,proposalId,decision:"approve" as const};
    expect(await run(a,command,{chatContainerMemberId:room,beforeMutationTx:fence})).toMatchObject({ok:false,error:{code:"NOT_A_PLAYER"}});
    expect(await run(b,command)).toMatchObject({ok:false,error:{code:"NOT_A_PLAYER"}});
    expect(await run(b,command,{chatContainerMemberId:"wrong_room",beforeMutationTx:fence})).toMatchObject({ok:false,error:{code:"NOT_A_PLAYER"}});
    const results=await Promise.all([1,2].map(()=>run(b,command,{chatContainerMemberId:room,beforeMutationTx:fence})));
    expect(results.every((r)=>r.ok)).toBe(true);
    const view=await readGame(gameId,a); expect(view?.pendingChange).toBeNull(); expect(view?.terms.n).toBe(2); expect(view?.lengthDays).toBe(14); expect(view?.terms.schedule).toEqual({days:[5,6]});
    expect(await getPrisma().gameEvent.count({where:{gameId,type:"change_applied"}})).toBe(1);
    // Replaying the original request cannot revive the resolved proposal.
    await run(a,{type:"proposeChange",gameId,proposalId,expectedTermsVersion:1,change:{kind:"edit",lengthDays:14}});
    expect((await readGame(gameId,a))?.pendingChange).toBeNull();
    const shared=await readGameChatState(room,[a,b]); expect(JSON.stringify(shared)).not.toContain("Private nickname");
    expect(shared.games[0].players.map((p)=>p.firstName).sort()).toEqual(["Jordan","Riley"]);
    expect(JSON.stringify(shared)).not.toContain("inviteToken"); expect(JSON.stringify(shared)).not.toContain("avatarUrl");
  });
  it("starts both players on the agreed date only after the other approves", async () => {
    const {a,b,room,gameId}=await setup(); const proposalId=randomUUID();
    await run(a,{type:"proposeChange",gameId,proposalId,expectedTermsVersion:1,change:{kind:"start_now"}});
    const pending=(await readGame(gameId,a))!.pendingChange!;
    expect(pending.startsOn).toBe(gameLocalDate(new Date(),"America/New_York"));
    expect((await getPrisma().gamePlayer.findMany({where:{gameId}})).every((p)=>p.dayOne!.toISOString().slice(0,10)!==pending.startsOn)).toBe(true);
    const result=await run(b,{type:"respondChange",gameId,proposalId,decision:"approve"},{chatContainerMemberId:room,beforeMutationTx:fence});
    expect(result).toEqual({ok:true,game:null});
    expect((await getPrisma().gamePlayer.findMany({where:{gameId}})).map((p)=>p.dayOne!.toISOString().slice(0,10))).toEqual([pending.startsOn,pending.startsOn]);
  });
  it("serializes competing proposals, supports decline, and rechecks the runtime fence", async () => {
    const {a,b,room,gameId}=await setup();
    const attempts=await Promise.all([a,b].map((actor)=>run(actor,{type:"proposeChange",gameId,proposalId:randomUUID(),expectedTermsVersion:1,change:{kind:"edit",lengthDays:10}})));
    expect(attempts.filter((r)=>r.ok)).toHaveLength(1); expect(attempts.find((r)=>!r.ok)).toMatchObject({ok:false,error:{code:"CHANGE_PENDING"}});
    const pending=(await readGame(gameId,a))!.pendingChange!; const other=pending.proposedByMemberId===a?b:a;
    const command={type:"respondChange" as const,gameId,proposalId:pending.id,decision:"decline" as const};
    await expect(run(other,command,{chatContainerMemberId:room,beforeMutationTx:async()=>{throw new Error("revoked");}})).rejects.toThrow("revoked");
    expect((await readGame(gameId,a))?.pendingChange?.id).toBe(pending.id);
    expect(await run(other,command,{chatContainerMemberId:room,beforeMutationTx:fence})).toMatchObject({ok:true});
    expect((await readGame(gameId,a))?.pendingChange).toBeNull();
  });
  it("projects terminal delivery honestly and lets only the proposer cancel from the app", async () => {
    const {a,b,room,gameId}=await setup(); const proposalId=randomUUID();
    await run(a,{type:"proposeChange",gameId,proposalId,expectedTermsVersion:1,change:{kind:"edit",lengthDays:14}});
    const deliveryId=randomUUID();
    await getPrisma().hostedLinqDelivery.create({data:{id:deliveryId,idempotencyKey:createHostedLinqDeliveryIdempotencyLookupKey(`game-change:${gameId}:${proposalId}`),source:"game_test",status:"failed",attemptedAt:new Date()}});
    try {
      expect((await readGame(gameId,a))?.pendingChange).toMatchObject({deliveryStatus:"failed",deliveryRetryable:false});
      const command={type:"respondChange" as const,gameId,proposalId,decision:"cancel" as const};
      expect(await run(b,command)).toMatchObject({ok:false,error:{code:"NOT_A_PLAYER"}});
      expect(await run(a,command)).toMatchObject({ok:true});
      expect(await run(a,command)).toMatchObject({ok:true});
      expect((await readGame(gameId,a))?.lengthDays).toBe(7);
      expect((await readGame(gameId,a))?.pendingChange).toBeNull();
      expect((await readGameChatState(room,[a,"unrelated_player"])).games).toEqual([]);
    } finally { await getPrisma().hostedLinqDelivery.delete({where:{id:deliveryId}}); }
  });
  it("does not report a neutral chat opener as delivery of the pending proposal", async () => {
    const {a,gameId}=await setup(); const proposalId=randomUUID();
    await getPrisma().game.update({where:{id:gameId},data:{chatContainerMemberId:null}});
    delivery.mockRejectedValueOnce(new Error("binding unavailable"));
    await run(a,{type:"proposeChange",gameId,proposalId,expectedTermsVersion:1,change:{kind:"edit",lengthDays:14}});
    const deliveryId=randomUUID();
    await getPrisma().hostedLinqDelivery.create({data:{id:deliveryId,idempotencyKey:createHostedLinqDeliveryIdempotencyLookupKey(`game-chat:${gameId}`),source:"game_test",status:"accepted",attemptedAt:new Date()}});
    try {
      expect((await readGame(gameId,a))?.pendingChange).toMatchObject({deliveryStatus:"failed",deliveryRetryable:true});
    } finally { await getPrisma().hostedLinqDelivery.delete({where:{id:deliveryId}}); }
  });
  it("clears a stale approval without changing terms and persists retryable delivery failure", async () => {
    const {a,b,room,gameId}=await setup(); const proposalId=randomUUID();
    delivery.mockRejectedValueOnce(new Error("provider unavailable"));
    const proposed=await run(a,{type:"proposeChange",gameId,proposalId,expectedTermsVersion:1,change:{kind:"edit",lengthDays:14}});
    expect(proposed).toMatchObject({ok:true,game:{pendingChange:{deliveryStatus:"failed"}}});
    // Either player can retry, without replacing the proposal or approving it.
    await run(b,{type:"proposeChange",gameId,proposalId,expectedTermsVersion:1,change:{kind:"edit",lengthDays:20}});
    expect((await readGame(gameId,a))?.pendingChange).toMatchObject({proposedByMemberId:a,change:{kind:"edit",lengthDays:14}});
    const result=await run(b,{type:"respondChange",gameId,proposalId,decision:"approve"},{chatContainerMemberId:room,beforeMutationTx:fence,now:new Date(Date.now()+3*86400000)});
    expect(result).toMatchObject({ok:false,error:{code:"CHANGE_EXPIRED"}});
    const view=await readGame(gameId,a); expect(view?.terms.n).toBe(1); expect(view?.lengthDays).toBe(7); expect(view?.pendingChange).toBeNull();
  });
});
