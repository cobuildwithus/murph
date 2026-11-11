import { recapMediaAccessRequestSchema, type RecapMediaAccessRequest } from '@murphai/contracts/recap-admission';
import { vi } from 'vitest';
import * as transport from '../../src/runtime-platform/web-control-transport.ts';

const original = transport.fetchHostedWebControlPlaneJson;

/** Older provider cases are unscoped; preserve their provider/usage assertions. */
export function mockRecapMediaAdmission(result: unknown | ((body: RecapMediaAccessRequest) => unknown) = { scoped: false, allowed: true }) {
  return vi.spyOn(transport, 'fetchHostedWebControlPlaneJson').mockImplementation(async input => {
    if (input.route.path !== '/api/internal/hosted-execution/recap-media/access') return original(input);
    // Use the receiving Web route's actual schema; a permissive mock hid a
    // missing required field and would have blocked every ordinary media call.
    const body = recapMediaAccessRequestSchema.parse(input.body);
    if (typeof result === 'function') return result(body);
    if (result instanceof Error) throw result;
    return result;
  });
}
