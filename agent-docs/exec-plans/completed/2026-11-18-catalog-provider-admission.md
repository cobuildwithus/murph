# Verify product model and service tier admission

Production image promotion requires real provider acceptance for the advertised product models. The public PR gate must stay deterministic and credential free. The five-minute foreground rejection alert in #5187 remains the post-release signal.

- Exercise the native candidate catalog across all selectable models and the standard, Flex and Priority request shapes. Use the protected smoke container, one bounded model- and tier-specific grant per request and content-free receipts.
- Confirm the observed requests match their intended catalog and tier. Keep the optional serving Luna probe compatible with existing callers.
- Verify expected member input modalities independently of the upstream launch fixture. A synthetic text-only Astra catalog passed the previous image and wire tests.
- Run the focused contract and release tests, workspace typecheck, required GitHub checks and final review. Verify real provider receipts before member image replacement.

Local proof exercised all 15 native requests against a loopback Responses server and checked the actual model, tier, web namespace and image presence. Removing Astra image support from a disposable catalog failed the new modality check. After restoration, 744 focused Cloudflare tests, workspace typecheck and the complexity guard passed. Only protected deployment can supply provider acceptance evidence.
Status: completed
Updated: 2026-11-18
Completed: 2026-11-18
