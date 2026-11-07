import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { createPrismaClient } from '@/src/lib/prisma';
import { createHostedLinqChatLookupKey } from '@/src/lib/hosted-onboarding/contact-privacy';
import { createHostedLinqDeliverySourceRefLookupKey } from '@/src/lib/hosted-onboarding/linq-observability-identifiers';
import { claimHostedLinqAckReaction, confirmHostedLinqAckReaction } from '@/src/lib/hosted-onboarding/linq-ack-reaction-store';

const mocks = vi.hoisted(() => ({ prisma: vi.fn(), memberId: '', target: '', sourceEvent: '' }));
vi.mock('@/src/lib/prisma', async original => ({
  ...await original<typeof import('@/src/lib/prisma')>(), getPrisma: mocks.prisma,
}));
vi.mock('@/src/lib/hosted-execution/cloudflare-callback-auth', () => ({
  requireHostedCloudflareCallbackRequest: async () => mocks.memberId,
}));
vi.mock('@/src/lib/hosted-onboarding/linq-egress-engagement', async original => ({
  ...await original<typeof import('@/src/lib/hosted-onboarding/linq-egress-engagement')>(),
  assertHostedLinqRecentInboundEngagementForRuntime: async (input: { replyToMessageId?: string }) => ({
    sourceEventId: input.replyToMessageId === 'message-later' ? mocks.sourceEvent : 'event-final',
    resolvedRoute: { target: mocks.target, targetKind: 'thread', threadIsDirect: true,
      conversationThreadId: null, fromPhoneNumber: null, directRecipientPhoneNumber: null },
  }),
}));
import { POST } from '../app/api/internal/hosted-runtime/linq-egress/engagement/route';

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === '1';
const databaseUrl = process.env.DATABASE_URL ?? '';
if (enabled && !/^postgres(?:ql)?:\/\/[^@]*@(?:127\.0\.0\.1|localhost)[:/]/u.test(databaseUrl)) {
  throw new Error('The typing coverage PostgreSQL proof requires a local DATABASE_URL.');
}
afterEach(() => { vi.unstubAllEnvs(); });

it.skipIf(!enabled)('stalled coverage holds neither delivery lock and leaves every stale reservation field unchanged', async () => {
  vi.stubEnv('HOSTED_LINQ_ACK_REACTIONS', 'on');
  vi.stubEnv('HOSTED_LINQ_ACK_REACTION_OPENAI_API_KEY', 'test-key');
  vi.stubEnv('HOSTED_CONTACT_PRIVACY_KEYS', `v1:${Buffer.from('a'.repeat(32)).toString('base64')}`);
  vi.stubEnv('HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION', 'v1');
  delete (globalThis as { __murphHostedOnboardingEnv?: unknown }).__murphHostedOnboardingEnv;
  const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
  const suffix = randomUUID();
  mocks.memberId = `typing-proof-member-${suffix}`;
  mocks.target = `typing-proof-chat-${suffix}`;
  mocks.sourceEvent = `typing-proof-event-${suffix}`;
  let release!: () => void;
  const stalled = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const reading = new Promise<void>(resolve => { entered = resolve; });
  const extended = prisma.$extends({ query: {
    async $queryRaw({ args, query }) {
      const result = await query(args);
      if (JSON.stringify(args).includes('hosted_linq_ack_reaction')) {
        entered();
        await stalled;
      }
      return result;
    },
  } });
  mocks.prisma.mockReturnValue(extended);
  const staleId = `typing-proof-stale-${suffix}`;
  try {
    await prisma.hostedMember.create({ data: { id: mocks.memberId, billingStatus: 'active' } });
    const before = await prisma.hostedLinqDelivery.create({ data: {
      id: staleId, source: 'typing-proof', template: 'instant_first_turn_v1',
      sourceRef: createHostedLinqDeliverySourceRefLookupKey(mocks.sourceEvent),
      linqChatLookupKey: createHostedLinqChatLookupKey(mocks.target),
      attemptedAt: new Date(Date.now() - 600_000), status: 'attempted', retryAfterAt: new Date(0),
    } });
    const claimedAt = await claimHostedLinqAckReaction({ linqChatId: mocks.target,
      messageId: 'message-earlier', reaction: '⏰', messageReceivedAt: new Date(), prisma });
    expect(claimedAt).not.toBeNull();
    await confirmHostedLinqAckReaction({ linqChatId: mocks.target, claimedAt: claimedAt!, prisma });
    const request = (body: object) => new Request('https://web.example.test/api/internal/hosted-runtime/linq-egress/engagement', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: mocks.target, targetKind: 'thread', ...body }),
    });
    const coverage = POST(request({ authorityCheckOnly: true, deliveryPurpose: 'typing', replyToMessageId: 'message-later' }));
    await reading;
    // These are the actual route locks, not stubbed mutexes. A short lock timeout
    // makes any regression fail instead of waiting for the stalled read to finish.
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '300ms'`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('hosted-linq-routing:chat'), hashtext(${mocks.target}))`;
      await tx.$queryRaw`SELECT 1 FROM hosted_member WHERE id = ${mocks.memberId} FOR NO KEY UPDATE`;
    });
    const final = await POST(request({ authorityCheckOnly: false, idempotencyKey: `typing-proof-final-${suffix}`, replyToMessageId: 'message-final' }));
    expect(final.status).toBe(200);
    expect(await final.json()).toMatchObject({ providerDispatchClaimed: true });
    expect(await prisma.hostedLinqDelivery.findUniqueOrThrow({ where: { id: staleId } })).toEqual(before);
    release();
    expect(await (await coverage).json()).toEqual({ ok: true, ackCovered: true });
  } finally {
    release();
    await prisma.hostedLinqAckReaction.deleteMany({ where: { linqChatLookupKey: createHostedLinqChatLookupKey(mocks.target)! } });
    await prisma.hostedLinqDelivery.deleteMany({ where: { linqChatLookupKey: createHostedLinqChatLookupKey(mocks.target) } });
    await prisma.hostedMember.deleteMany({ where: { id: mocks.memberId } });
    await prisma.$disconnect();
    delete (globalThis as { __murphHostedOnboardingEnv?: unknown }).__murphHostedOnboardingEnv;
  }
}, 15_000);
