import assert from 'node:assert/strict'

import { test } from 'vitest'

import { mapImessageMessagesDbRuntimeError } from '../src/imessage-readiness.ts'

test('iMessage readiness runtime mapping covers DATABASE codes and non-object fallbacks', () => {
  const databaseError = Object.assign(new Error('ignored'), {
    code: 'DATABASE',
  })
  const mappedDatabaseError = mapImessageMessagesDbRuntimeError(databaseError, {
    fallbackCode: 'GENERIC_FAILURE',
    fallbackMessage: 'something broke',
    permissionCode: 'NO_PERMISSION',
    permissionMessage: 'grant access',
  })
  assert.equal(mappedDatabaseError.code, 'NO_PERMISSION')
  assert.equal(mappedDatabaseError.context?.causeCode, 'DATABASE')

  const mappedStringError = mapImessageMessagesDbRuntimeError('plain failure', {
    fallbackCode: 'GENERIC_FAILURE',
    fallbackMessage: 'something broke',
    permissionCode: 'NO_PERMISSION',
    permissionMessage: 'grant access',
  })
  assert.equal(mappedStringError.code, 'GENERIC_FAILURE')
  assert.equal(mappedStringError.message, 'something broke')
})
