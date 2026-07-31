# Assistant skill assets

Most assistant skills in this directory are the complete public implementation used by local and hosted Murph.

Five group-product paths are different:

- `group-chat`
- `groupchat-comedy`
- `group-challenge`
- `group-challenge-scorecards`
- `group-newsletter`

Their checked-in `SKILL.md` files are compact public contract baselines. They retain safety, identity, consent, shared-data, scoring, persistence, provider-truthfulness, and delivery rules so those boundaries remain auditable and local builds fail conservatively.

Murph Cloud owns the complete first-party hosted versions. During the existing runner-bundle build, the Cloudflare assembler recognizes Murph Cloud's current integration, protected-deploy, and sibling-checkout layouts. `MURPH_HOSTED_GROUP_SKILLS_ROOT` is the explicit override for a nonstandard layout. The assembler validates the exact allowlist, rejects symlinks and public baseline placeholders, and replaces only the installed copies before the immutable bundle is finalized.

The running container still reads one ordinary `MURPH_ASSISTANT_SKILLS_ROOT`. There is no runtime fetch, private registry dependency, second assistant engine, or private authority service. Public code continues to admit tools and enforce identity, data, consent, persistence, provider, and effect boundaries.
