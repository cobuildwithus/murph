import { createInboxBootstrapDoctorOps } from './bootstrap-doctor.js'
import { createInboxAppEnvironment } from './environment.js'
import { createInboxPromotionOps } from './promotions.js'
import { createInboxReadOps } from './reads.js'
import { createInboxRuntimeOps } from './runtime.js'
import { createInboxSourceOps } from './sources.js'

import type {
  InboxCliServices,
  InboxServicesDependencies,
} from './types.js'

export function createIntegratedInboxCliServices(
  dependencies: InboxServicesDependencies = {},
): InboxCliServices {
  const env = createInboxAppEnvironment(dependencies)

  return {
    ...createInboxBootstrapDoctorOps(env),
    ...createInboxSourceOps(env),
    ...createInboxRuntimeOps(env),
    ...createInboxReadOps(env),
    ...createInboxPromotionOps(env),
  }
}
