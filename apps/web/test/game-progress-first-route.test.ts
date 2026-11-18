import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { firstRoutePlaces, phoneRouteRegion } from '../src/lib/game/progress/routes';
import { recentMilesPerDay } from '../src/lib/game/progress/health-journeys';

const verified = (phoneNumber: string) => ({ phoneNumber, phoneNumberVerifiedAt: new Date('2026-11-01T00:00:00Z') });

describe('first Steps route', () => {
  it.each([
    ['+16195550123', 'socal'], ['+14155550123', 'norcal'], ['+12125550123', 'northeast'], ['+16045550123', 'canada-west'],
    ['+447700900123', 'gb'], ['+353851234567', 'ie'], ['+61412345678', 'au'], ['+819012345678', 'jp'],
  ])('maps %s to %s', (phone, region) => {
    expect(phoneRouteRegion(verified(phone))).toBe(region);
  });

  it('ignores unverified numbers, unknown codes and non-geographic NANP numbers', () => {
    expect(phoneRouteRegion({ phoneNumber: '+16195550123', phoneNumberVerifiedAt: null })).toBeNull();
    expect(phoneRouteRegion(verified('+8613812345678'))).toBeNull();
    expect(phoneRouteRegion(verified('+18005550123'))).toBeNull();
    expect(phoneRouteRegion(null)).toBeNull();
  });

  it('sizes the regional route to about 12 weeks at the member pace', () => {
    // 3,000 steps a day is 1.5 miles a day: San Diego to Los Angeles (121 mi) takes 81 days.
    expect(firstRoutePlaces('America/Los_Angeles', 'socal', 1.5)).toEqual({ from: 'San Diego', to: 'Los Angeles' });
    // 9,000 steps a day is 4.5 miles a day: Los Angeles to San Francisco (382 mi) takes 85 days.
    expect(firstRoutePlaces('America/Los_Angeles', 'socal', 4.5)).toEqual({ from: 'Los Angeles', to: 'San Francisco' });
    // No recent steps uses 3 miles a day: Los Angeles to Las Vegas (270 mi) takes 90 days.
    expect(firstRoutePlaces('America/Los_Angeles', 'socal', null)).toEqual({ from: 'Los Angeles', to: 'Las Vegas' });
  });

  it('falls back to the time-zone route without a region', () => {
    expect(firstRoutePlaces('America/New_York', null, 4)).toEqual({ from: 'New York', to: 'Washington, D.C.' });
    expect(firstRoutePlaces('Europe/London', 'nowhere', 4)).toEqual(firstRoutePlaces('Europe/London', null, 4));
  });

  it('averages the 30 settled days before the last observed day, and needs a week of them', () => {
    const day = (date: string, amount: number) => ({ measureId: 'steps', date, amount });
    const week = ['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09'].map(date => day(date, 8_000));
    const amounts = [day('2026-10-01', 30_000), ...week, day('2026-11-10', 0), day('2026-11-12', 8_000)];
    expect(recentMilesPerDay(amounts)).toBe(4);
    expect(recentMilesPerDay(amounts.slice(0, 6))).toBeNull();
    expect(recentMilesPerDay([])).toBeNull();
  });
});
