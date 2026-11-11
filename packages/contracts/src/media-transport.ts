/** A closed vocabulary shared by the Worker and host. Never serialize error text. */
export const MEDIA_TRANSPORT_NAMES = ['Error', 'TypeError', 'AbortError', 'TimeoutError', 'FetchError', 'ElevenLabsTimeoutError', 'unknown'] as const;
export const MEDIA_TRANSPORT_CODES = ['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'ABORT_ERR', 'WORKER_SUBREQUEST_LIMIT', 'WORKER_CONNECTION_LIMIT', 'unknown'] as const;
export const MEDIA_ELAPSED_BUCKETS = ['lt_1s', '1_30s', '30_90s', '90_300s', 'ge_300s'] as const;
export type MediaTransportDetails = {
  mediaTransportName?: typeof MEDIA_TRANSPORT_NAMES[number];
  mediaTransportCode?: typeof MEDIA_TRANSPORT_CODES[number];
  mediaElapsedMsBucket?: typeof MEDIA_ELAPSED_BUCKETS[number];
  mediaResponseHeadersReceived?: boolean;
};
export function mediaElapsedBucket(ms: number): typeof MEDIA_ELAPSED_BUCKETS[number] {
  return ms < 1000 ? 'lt_1s' : ms < 30_000 ? '1_30s' : ms < 90_000 ? '30_90s' : ms < 300_000 ? '90_300s' : 'ge_300s';
}
export function readMediaTransportError(error: unknown): MediaTransportDetails {
  let name: MediaTransportDetails['mediaTransportName'] = 'unknown';
  let code: MediaTransportDetails['mediaTransportCode'] = 'unknown';
  for (let depth = 0; error && depth < 4; depth++) {
    name = MEDIA_TRANSPORT_NAMES.find(value => value === (domExceptionName(error) ?? dataProperty(error, 'name'))) ?? name;
    code = MEDIA_TRANSPORT_CODES.find(value => value === dataProperty(error, 'code')) ?? code;
    const message = dataProperty(error, 'message');
    if (typeof message === 'string' && /too many subrequests|subrequest limit/iu.test(message)) code = 'WORKER_SUBREQUEST_LIMIT';
    if (typeof message === 'string' && /too many (?:simultaneous )?(?:open )?connections|connection limit/iu.test(message)) code = 'WORKER_CONNECTION_LIMIT';
    error = dataProperty(error, 'cause');
  }
  return { mediaTransportName: name, mediaTransportCode: code };
}
function dataProperty(value: unknown, key: string): unknown {
  try {
    for (let depth = 0; value && typeof value === 'object' && depth < 4; depth++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor) return 'value' in descriptor ? descriptor.value : undefined;
      value = Object.getPrototypeOf(value);
    }
  } catch { /* Proxies and foreign errors are not diagnostic authority. */ }
  return undefined;
}

function domExceptionName(value: unknown): unknown {
  try { return Object.getOwnPropertyDescriptor(DOMException.prototype, 'name')?.get?.call(value); }
  catch { return undefined; }
}
