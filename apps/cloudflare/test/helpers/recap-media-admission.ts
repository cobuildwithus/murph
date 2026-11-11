import { vi } from 'vitest';
import * as transport from '../../src/runtime-platform/web-control-transport.ts';

const original = transport.fetchHostedWebControlPlaneJson;

/** Older provider cases are unscoped; preserve their provider/usage assertions. */
export function mockRecapMediaAdmission(result: unknown = { scoped: false, allowed: true }) {
  return vi.spyOn(transport, 'fetchHostedWebControlPlaneJson').mockImplementation(async input => {
    if (input.route.path !== '/api/internal/hosted-execution/recap-media/access') return original(input);
    if (result instanceof Error) throw result;
    return result;
  });
}
