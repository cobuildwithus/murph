export const INVALID_GATEWAY_RUNTIME_ID_CODE = 'ASSISTANT_INVALID_RUNTIME_ID'
export const GATEWAY_UNSUPPORTED_OPERATION_CODE = 'ASSISTANT_GATEWAY_UNSUPPORTED_OPERATION'
export const GATEWAY_SESSION_NOT_FOUND_CODE = 'ASSISTANT_GATEWAY_SESSION_NOT_FOUND'

export function createGatewayInvalidRuntimeIdError(
  message: string,
): Error & { code: string } {
  const error = new Error(message) as Error & { code: string }
  error.code = INVALID_GATEWAY_RUNTIME_ID_CODE
  return error
}

export function createGatewayUnsupportedOperationError(
  message: string,
): Error & { code: string } {
  const error = new Error(message) as Error & { code: string }
  error.code = GATEWAY_UNSUPPORTED_OPERATION_CODE
  return error
}

export function createGatewaySessionNotFoundError(
  message: string,
): Error & { code: string } {
  const error = new Error(message) as Error & { code: string }
  error.code = GATEWAY_SESSION_NOT_FOUND_CODE
  return error
}
