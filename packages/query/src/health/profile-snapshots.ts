import {
  matchesLookup,
} from "./shared.ts";
import {
  readOptionalMarkdownDocumentOutcome,
} from "./loaders.ts";
import {
  readCurrentProfileCollectionAsync,
  readProfileSnapshotEntitiesStrict,
} from "./entity-slices.ts";
import {
  buildCurrentProfileRecord,
  compareSnapshots,
  currentProfileRecordFromEntity,
  selectProfileSnapshotRecords,
  toCurrentProfileRecord,
  toProfileSnapshotRecord,
  type CurrentProfileQueryRecord,
  type ProfileSnapshotListOptions,
  type ProfileSnapshotQueryRecord,
} from "./projections.ts";

interface CurrentProfileState {
  currentProfile: CurrentProfileQueryRecord | null;
  snapshots: ProfileSnapshotQueryRecord[];
}
export type {
  CurrentProfileQueryRecord,
  ProfileSnapshotListOptions,
  ProfileSnapshotQueryRecord,
} from "./projections.ts";
export {
  buildCurrentProfileRecord,
  compareSnapshots,
  toCurrentProfileRecord,
  toProfileSnapshotRecord,
} from "./projections.ts";

export async function listProfileSnapshots(
  vaultRoot: string,
  options: ProfileSnapshotListOptions = {},
): Promise<ProfileSnapshotQueryRecord[]> {
  return selectProfileSnapshotRecords(
    await readProfileSnapshotEntitiesStrict(vaultRoot),
    options,
  );
}

export async function readProfileSnapshot(
  vaultRoot: string,
  snapshotId: string,
): Promise<ProfileSnapshotQueryRecord | null> {
  const snapshots = await listProfileSnapshots(vaultRoot);
  return snapshots.find((snapshot) => snapshot.id === snapshotId) ?? null;
}

export async function readCurrentProfile(
  vaultRoot: string,
): Promise<CurrentProfileQueryRecord | null> {
  return (await readCurrentProfileState(vaultRoot)).currentProfile;
}

export async function showProfile(
  vaultRoot: string,
  lookup: string,
): Promise<ProfileSnapshotQueryRecord | CurrentProfileQueryRecord | null> {
  const { currentProfile, snapshots } = await readCurrentProfileState(vaultRoot);
  if (currentProfile && matchesLookup(lookup, currentProfile.id, currentProfile.snapshotId)) {
    return currentProfile;
  }

  return snapshots.find((snapshot) => matchesLookup(lookup, snapshot.id, snapshot.summary)) ?? null;
}

async function readCurrentProfileState(
  vaultRoot: string,
): Promise<CurrentProfileState> {
  const snapshotEntities = await readProfileSnapshotEntitiesStrict(vaultRoot);
  const snapshots = selectProfileSnapshotRecords(snapshotEntities);
  const markdownByPath = new Map<string, string>();
  const currentProfile = await readCurrentProfileCollectionAsync(
    vaultRoot,
    snapshotEntities,
    markdownByPath,
    readOptionalMarkdownDocumentOutcome,
  );

  return {
    currentProfile: currentProfile.entity
      ? currentProfileRecordFromEntity(
          currentProfile.entity,
          markdownByPath.get(currentProfile.entity.path) ?? currentProfile.entity.body,
        )
      : null,
    snapshots,
  };
}
