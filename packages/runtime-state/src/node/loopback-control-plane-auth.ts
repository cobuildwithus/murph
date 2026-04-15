import { timingSafeEqual } from 'node:crypto'

import {
  readLoopbackControlHeaderValue,
  type LoopbackControlHeaderValue,
} from '../loopback-control-plane.ts'

export function hasMatchingLoopbackControlBearerToken(
  value: LoopbackControlHeaderValue,
  expectedToken: string,
): boolean {
  const providedToken = readLoopbackControlBearerToken(value)
  if (!providedToken) {
    return false
  }

  const expected = Buffer.from(expectedToken, 'utf8')
  const provided = Buffer.from(providedToken, 'utf8')
  return expected.length === provided.length && timingSafeEqual(expected, provided)
}

function readLoopbackControlBearerToken(
  value: LoopbackControlHeaderValue,
): string | null {
  const header = readLoopbackControlHeaderValue(value)
  if (!header) {
    return null
  }

  const match = header.match(/^bearer\s+(.+)$/iu)
  return match?.[1]?.trim() || null
}
