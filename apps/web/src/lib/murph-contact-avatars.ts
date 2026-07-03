export type MurphContactAvatarKind = "headshot" | "logo" | "blank";

export interface MurphContactAvatarOption {
  id: string;
  kind: MurphContactAvatarKind;
  label: string;
  /**
   * Square raster asset used both for picker display and for embedding as
   * the vCard `PHOTO`. Absent only for the no-photo option.
   */
  src?: string;
}

export const MURPH_CONTACT_AVATAR_OPTIONS: readonly MurphContactAvatarOption[] = [
  {
    id: "hooded",
    kind: "headshot",
    label: "Hooded",
    src: "/murph-headshots/murph-headshot-01-sm.png",
  },
  {
    id: "classic",
    kind: "headshot",
    label: "Classic",
    src: "/murph-headshots/murph-headshot-02-sm.png",
  },
  {
    id: "rancher",
    kind: "headshot",
    label: "Rancher",
    src: "/murph-headshots/murph-headshot-05-sm.png",
  },
  {
    id: "referee",
    kind: "headshot",
    label: "Referee",
    src: "/murph-headshots/murph-headshot-04-sm.png",
  },
  { id: "none", kind: "blank", label: "No photo" },
  {
    id: "gremlin",
    kind: "headshot",
    label: "Gremlin",
    src: "/murph-headshots/murph-headshot-03-sm.png",
  },
  {
    id: "cool",
    kind: "headshot",
    label: "Cool",
    src: "/murph-headshots/murph-headshot-06-sm.png",
  },
  {
    id: "disco",
    kind: "headshot",
    label: "Disco",
    src: "/murph-headshots/murph-headshot-07-sm.png",
  },
  {
    id: "beanie",
    kind: "headshot",
    label: "Beanie",
    src: "/murph-headshots/murph-headshot-08-sm.png",
  },
  {
    id: "headphones",
    kind: "headshot",
    label: "Headphones",
    src: "/murph-headshots/murph-headshot-09-sm.png",
  },
  {
    id: "sleepy",
    kind: "headshot",
    label: "Sleepy",
    src: "/murph-headshots/murph-headshot-10-sm.png",
  },
  {
    id: "logo-dark",
    kind: "logo",
    label: "Dark",
    src: "/brand-logos/murph-logo-avatar-dark.png",
  },
  {
    id: "logo-light",
    kind: "logo",
    label: "Light",
    src: "/brand-logos/murph-logo-avatar-light.png",
  },
];

export const DEFAULT_MURPH_CONTACT_AVATAR_ID = "classic";

export function findMurphContactAvatarOption(id: string): MurphContactAvatarOption {
  return (
    MURPH_CONTACT_AVATAR_OPTIONS.find((option) => option.id === id)
    ?? MURPH_CONTACT_AVATAR_OPTIONS.find(
      (option) => option.id === DEFAULT_MURPH_CONTACT_AVATAR_ID,
    )
    ?? MURPH_CONTACT_AVATAR_OPTIONS[0]
  );
}
