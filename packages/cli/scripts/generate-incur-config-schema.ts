import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  configSchemaPath,
  generateIncurArtifacts,
  incurGeneratedTypesPath,
  packageDir,
  vaultCliSkillHashPath,
} from './incur-config-schema.js'

const generatedArtifacts = await generateIncurArtifacts({
  onStage: (message) => console.log(message),
})
console.log('Writing generated CLI artifacts.')
await writeFile(configSchemaPath, generatedArtifacts.configSchema)
await writeFile(incurGeneratedTypesPath, generatedArtifacts.types)
await writeFile(vaultCliSkillHashPath, generatedArtifacts.skillHashModule)

console.log(path.relative(packageDir, configSchemaPath))
console.log(path.relative(packageDir, incurGeneratedTypesPath))
console.log(path.relative(packageDir, vaultCliSkillHashPath))
