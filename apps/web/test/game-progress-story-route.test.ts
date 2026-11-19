import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ auth: vi.fn(), current: vi.fn(), vault: vi.fn(), story: vi.fn() }));
vi.mock('@/src/lib/game/http/auth', () => ({ requireGameMemberAuth: mocks.auth, assertGameMemberAuthCurrentTx: mocks.current }));
vi.mock('@/src/lib/browser-vault/authority', () => ({ assertBrowserVaultMemberAuthority: mocks.vault }));
vi.mock('@/src/lib/game/progress/place-story', () => ({ readTownStory: mocks.story }));
import { GET } from '../app/api/game/v1/progress/story/route';
import { storySchema } from '../src/lib/game/progress/contract';
const request = (query: string) => new Request(`https://example.test/api/game/v1/progress/story?${query}`);
beforeEach(() => {
  vi.resetAllMocks(); mocks.auth.mockResolvedValue({ member: { id: 'owner' } });
  mocks.story.mockImplementation(async (_member: string, _query: unknown, before: (tx: object) => Promise<void>) => {
    await before({ synthetic: true });
    return { state: 'ready', title: 'River mills town', facts: ['One.', 'Two.', 'Three.'] };
  });
});
describe('Progress story HTTP contract', () => {
  it('reads a town of the member\'s own route, privately', async () => {
    const response = await GET(request('measure=walk.meters&town=2'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(storySchema.parse(await response.json())).toMatchObject({ state: 'ready', title: 'River mills town' });
    expect(mocks.story).toHaveBeenCalledWith('owner', { measure: 'walk.meters', town: 2 }, expect.any(Function));
    expect(mocks.current).toHaveBeenCalledTimes(1); expect(mocks.vault).not.toHaveBeenCalled();
  });
  it('holds Steps towns to the vault authority Steps reads need', async () => {
    expect((await GET(request('measure=steps&town=0'))).status).toBe(200);
    expect(mocks.vault).toHaveBeenCalledWith({ memberId: 'owner', prisma: { synthetic: true } });
  });
  it.each(['measure=steps', 'measure=steps&town=-1', 'measure=steps&town=x', 'measure=steps&town=0&extra=1', 'town=0'])('refuses %s', async query => {
    expect((await GET(request(query))).status).toBe(400);
    expect(mocks.story).not.toHaveBeenCalled();
  });
  it('needs a signed-in member', async () => {
    const { hostedOnboardingError } = await import('../src/lib/hosted-onboarding/errors');
    mocks.auth.mockRejectedValue(hostedOnboardingError({ code: 'AUTH_REQUIRED', httpStatus: 401, message: 'Sign in again.' }));
    expect((await GET(request('measure=steps&town=0'))).status).toBe(401);
    expect(mocks.story).not.toHaveBeenCalled();
  });
});
