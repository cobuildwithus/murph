import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), current: vi.fn(), read: vi.fn(), start: vi.fn(), image: vi.fn(), decide: vi.fn(), grant: vi.fn(), event: vi.fn() }));
vi.mock('@/src/lib/game/http/auth', () => ({ requireGameMemberAuth: mocks.auth, assertGameMemberAuthCurrentTx: mocks.current }));
vi.mock('@/src/lib/game/progress/shares', async original => ({ ...await original<object>(), readProgressShare: mocks.read, startProgressShare: mocks.start, readProgressShareImage: mocks.image }));
vi.mock('@/src/lib/game/progress/share-consent', async original => ({ ...await original<object>(), decideProgressShareConsent: mocks.decide }));
vi.mock('@/src/lib/prisma', () => ({ getPrisma: () => ({ hostedConsentGrant: { findUnique: mocks.grant }, hostedConsentEvent: { findFirst: mocks.event } }) }));
import { GET, POST, maxDuration } from '../app/api/game/v1/progress/shares/[awardId]/route';
import { GET as imageGET } from '../app/api/game/v1/progress/shares/[awardId]/image/route';
import { GET as consentGET, PUT } from '../app/api/game/v1/progress/share-consent/route';
import { shareViewSchema, type ShareView } from '../src/lib/game/progress/contract';
import { shareNotFound } from '../src/lib/game/progress/shares';
import { hostedOnboardingError } from '../src/lib/hosted-onboarding/errors';
const awardId = 'opaque:game-progress-award:v1:synthetic';
const context = { params: Promise.resolve({ awardId }) };
const card = { name: 'Mont Blanc', contextLine: 'You’ve done enough pushups to scale all 15,766 ft.', valueText: '15,766 pushups', face: { drawing: 'mont-blanc' }, messageText: 'I’ve done enough pushups to scale Mont Blanc' };
const view = (presentation: ShareView['presentation']): ShareView => ({ awardId, card, presentation });
const req = (method = 'GET', body?: string) => new Request(`https://example.test/api/game/v1/progress/shares/${awardId}`, { method, body });
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ member: { id: 'member-ava' } }); });
describe('private Progress share HTTP contract', () => {
  it.each([
    { state: 'needs_photo' }, { state: 'medal' }, { state: 'available' },
    { state: 'generating', startedAt: '2026-11-16T12:00:00.000Z', expiresAt: '2026-11-16T12:04:00.000Z', typicalSeconds: 55 },
    { state: 'photo', imagePath: `/api/game/v1/progress/shares/${awardId}/image` },
  ] satisfies ShareView['presentation'][])('GET only reads the strict $state view', async presentation => {
    mocks.read.mockResolvedValue(view(presentation));
    const response = await GET(req(), context);
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json(); expect(shareViewSchema.parse(body)).toEqual(view(presentation));
    expect(mocks.start).not.toHaveBeenCalled(); expect(JSON.stringify(body)).not.toMatch(/storageKey|access_token|providerUrl|prompt/u);
    expect(mocks.read.mock.calls[0][0]).toMatchObject({ memberId: 'member-ava', awardId, beforeMutationTx: expect.any(Function) });
  });
  it('has no failed wire state and no ambiguous presentation fields', () => {
    expect(shareViewSchema.safeParse(view({ state: 'medal', ...{ code: 'refused' } })).success).toBe(false);
    expect(shareViewSchema.safeParse({ ...view({ state: 'medal' }), presentation: { state: 'failed', code: 'refused' } }).success).toBe(false);
  });
  it.each([['generating', 202], ['photo', 200], ['medal', 200]] as const)('POST admits once and returns %s with %d', async (state, status) => {
    const presentation = state === 'generating' ? { state, startedAt: '2026-11-16T12:00:00.000Z', expiresAt: '2026-11-16T12:04:00.000Z', typicalSeconds: 55 }
      : state === 'photo' ? { state, imagePath: `/api/game/v1/progress/shares/${awardId}/image` } : { state };
    mocks.start.mockImplementation(async input => { await input.beforeMutationTx({ synthetic: true }); return view(presentation); });
    const response = await POST(req('POST'), context);
    expect(response.status).toBe(status); expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.current).toHaveBeenCalledWith({ member: { id: 'member-ava' } }, { synthetic: true }); expect(maxDuration).toBe(300);
  });
  it.each(['{}', '{"prompt":"PRIVATE_TASK_SENTINEL"}', '{"memberId":"member-leo"}', '{"url":"https://example.test"}'])('rejects every nonempty body before admission', async body => {
    expect([400, 413]).toContain((await POST(req('POST', body), context)).status); expect(mocks.start).not.toHaveBeenCalled();
  });
  it.each([GET, POST, imageGET])('invalid, absent and foreign awards return indistinguishable private 404s', async handler => {
    const request = () => req(handler === POST ? 'POST' : 'GET');
    const malformed = await handler(request(), { params: Promise.resolve({ awardId: 'not/a/path' }) });
    for (const fn of [mocks.read, mocks.start, mocks.image]) fn.mockRejectedValue(shareNotFound());
    const unknown = await handler(request(), context);
    expect(malformed.status).toBe(404); expect(unknown.status).toBe(404); expect(await unknown.json()).toEqual(await malformed.json());
    expect(unknown.headers.get('cache-control')).toBe('private, no-store');
  });
  it('returns exact JPEG bytes and clears the service buffer after copying', async () => {
    const bytes = new Uint8Array([255, 216, 255, 217]); mocks.image.mockResolvedValue(bytes);
    const response = await imageGET(req(), context);
    expect(response.headers.get('content-type')).toBe('image/jpeg'); expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([255, 216, 255, 217]); expect([...bytes]).toEqual([0, 0, 0, 0]);
  });
  it('requires bearer authority before any private read or effect', async () => {
    mocks.auth.mockRejectedValue(hostedOnboardingError({ code: 'AUTH_REQUIRED', httpStatus: 401, message: 'Sign in to continue.' }));
    for (const handler of [GET, POST, imageGET]) expect((await handler(req(handler === POST ? 'POST' : 'GET'), context)).status).toBe(401);
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.image).not.toHaveBeenCalled();
  });
  it('returns the bounded quota interval without private data and sanitizes infrastructure errors', async () => {
    mocks.start.mockRejectedValue(hostedOnboardingError({ code: 'PROGRESS_SHARE_LIMIT', httpStatus: 429, message: 'Another picture can be made later.', details: { retryAfterSeconds: 240 } }));
    const limited = await POST(req('POST'), context); expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: { details: { retryAfterSeconds: 240 } } });
    mocks.start.mockRejectedValue(new Error('PRIVATE_PROVIDER_SENTINEL'));
    const failed = await POST(req('POST'), context); expect(failed.status).toBe(503); expect(await failed.text()).not.toContain('PRIVATE_PROVIDER_SENTINEL');
    expect(failed.headers.get('cache-control')).toBe('private, no-store');
  });
});
describe('native face-use decision', () => {
  const consentRequest = (method = 'GET') => new Request('https://example.test/api/game/v1/progress/share-consent', { method });
  it.each([
    { grant: null, event: null, decision: 'allowed' },
    { grant: null, event: { action: 'declined' }, decision: 'denied' },
    { grant: { status: 'granted' }, event: null, decision: 'allowed' },
    { grant: { status: 'revoked' }, event: null, decision: 'denied' },
    { grant: { status: 'granted' }, event: { action: 'declined' }, decision: 'allowed' },
  ])('GET resolves $decision from the same consent owner as sharing', async ({ grant, event, decision }) => {
    mocks.grant.mockResolvedValue(grant); mocks.event.mockResolvedValue(event);
    const request = consentRequest();
    const response = await consentGET(request);
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ decision });
    expect(mocks.auth).toHaveBeenCalledWith(request);
    expect(mocks.grant).toHaveBeenCalledExactlyOnceWith({ where: { memberId_scope: { memberId: 'member-ava', scope: 'feature.progress-share-images' } }, select: { status: true } });
    if (grant) expect(mocks.event).not.toHaveBeenCalled();
    else expect(mocks.event).toHaveBeenCalledExactlyOnceWith({ where: { memberId: 'member-ava', scope: 'feature.progress-share-images' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { action: true } });
    expect(mocks.decide).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
  });
  it.each([consentGET, PUT])('requires the same bearer auth before reading or changing consent', async handler => {
    mocks.auth.mockRejectedValue(hostedOnboardingError({ code: 'AUTH_REQUIRED', httpStatus: 401, message: 'Sign in to continue.' }));
    const response = await handler(consentRequest(handler === PUT ? 'PUT' : 'GET'));
    expect(response.status).toBe(401); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.grant).not.toHaveBeenCalled(); expect(mocks.event).not.toHaveBeenCalled(); expect(mocks.decide).not.toHaveBeenCalled();
  });
  it('does not turn a failed consent read into permission', async () => {
    mocks.grant.mockRejectedValue(new Error('PRIVATE_DATABASE_SENTINEL'));
    const response = await consentGET(consentRequest());
    expect(response.status).toBe(503); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text()).not.toContain('PRIVATE_DATABASE_SENTINEL');
    expect(mocks.event).not.toHaveBeenCalled();
  });
  it.each(['allow', 'deny'])('delegates %s to the same atomic owner as Web revoke', async decision => {
    mocks.decide.mockImplementation(async input => { await input.beforeMutationTx({ synthetic: true }); return { decision: decision === 'allow' ? 'allowed' : 'denied' }; });
    const response = await PUT(req('PUT', JSON.stringify({ decision, disclosureVersion: 1 })));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ decision: decision === 'allow' ? 'allowed' : 'denied' });
    expect(mocks.decide).toHaveBeenCalledTimes(1); expect(mocks.current).toHaveBeenCalledTimes(1);
  });
  it.each([{ decision: 'allow', disclosureVersion: 2 }, { decision: 'allow' }, { decision: 'yes', disclosureVersion: 1 },
    { decision: 'allow', disclosureVersion: 1, memberId: 'member-leo' }])('rejects unknown version and extra fields', async body => {
    expect((await PUT(req('PUT', JSON.stringify(body)))).status).toBe(400); expect(mocks.decide).not.toHaveBeenCalled();
  });
});
