import { describe, expect, it } from 'vitest'

import { MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION } from '../src/assistant/managed-automations.js'

describe('automatic meal closeout automation', () => {
  it('fails the run when a selected photo is still pending after review', () => {
    expect(MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION.instructions).toContain(
      'A review-completion failure or any selected pending photo attachment remaining fails the run',
    )
  })
})
