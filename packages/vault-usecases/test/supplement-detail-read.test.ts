import { describe, expect, it } from 'vitest'
import { toSupplementDetailedListEntity, toSupplementReadEntity } from '../src/usecases/regimen-read-entities.js'

describe('supplement detailed inventory projection', () => {
  it.each([undefined, '', 'Full narrative body.\nKeep this final instruction.'])('preserves body %j and all structured evidence', body => {
    const record = {
      entity: { regimenId: 'reg_synthetic', title: 'Test supplement', status: 'active',
        dose: null, servingSize: '2 capsules', note: 'Do not assume a personal dose.',
        ingredients: [{ compound: 'Test compound', amount: 1, unit: 'mg', active: false }],
      },
      document: { markdown: 'Full original markdown fallback.', ...(body === undefined ? {} : { body }) },
    }
    const detailed = toSupplementDetailedListEntity(record)
    expect(detailed).toEqual({ ...toSupplementReadEntity(record), markdown: body ?? record.document.markdown })
    expect(detailed.data.dose).toBeNull()
    expect(detailed.data.ingredients).toEqual(record.entity.ingredients)
  })
})
