import { GroupsWorkspacePrototype } from "@/src/components/hosted-groups/groups-workspace-prototype";

export function GroupsWorkspacePrototypeStudy() {
  return (
    <div
      id="groups-workspace-prototype"
      data-design-section="groups-workspace-prototype"
      data-design-state="owner-selected-desktop-and-responsive"
      className="rounded-2xl border border-border bg-background p-4 sm:p-8"
      inert
    >
      <GroupsWorkspacePrototype />
    </div>
  );
}
