from pathlib import Path
import runpy


path = Path(".agent-patch/final-contact-card-boundary-v2.py")
text = path.read_text()

old_workspace = '''replace_once(
    WORKSPACE_PHASE,
    ''' + "'''" + '''        return linqRoute?.service === "sms"
          ? buildHostedGroupSmsUnsupportedResponse(request)
          : await forwardRequest(request);
''' + "'''" + ''',
    ''' + "'''" + '''        return linqRoute?.service === "sms"
          ? buildHostedGroupSmsUnsupportedResponse(request)
          : {
            action: "share_contact_card",
            result: {
              status: "unavailable",
              unavailableReason: "direct_attachment_route_unavailable",
            },
          };
''' + "'''" + ''',
)
'''
new_workspace = '''replace_once_in_block(
    WORKSPACE_PHASE,
    ''' + "'''" + '''      if (
        request.action === "share_contact_card"
        && request.contactCardImageUrl !== undefined
      ) {
''' + "'''" + ''',
    ''' + "'''" + '''      if (
        request.action !== "update_display_name"
''' + "'''" + ''',
    ''' + "'''" + '''        return linqRoute?.service === "sms"
          ? buildHostedGroupSmsUnsupportedResponse(request)
          : await forwardRequest(request);
''' + "'''" + ''',
    ''' + "'''" + '''        return linqRoute?.service === "sms"
          ? buildHostedGroupSmsUnsupportedResponse(request)
          : {
            action: "share_contact_card",
            result: {
              status: "unavailable",
              unavailableReason: "direct_attachment_route_unavailable",
            },
          };
''' + "'''" + ''',
)
'''
if text.count(old_workspace) != 1:
    raise RuntimeError("could not locate the unscoped workspace replacement")
text = text.replace(old_workspace, new_workspace, 1)

old_exec = '''    ''' + "'''" + '''- Personalized sends reuse the existing durable contact-card reservation table under a separate blinded per-chat variant key, so automatic or canonical cards cannot suppress an explicit personalized request.
''' + "'''" + ''',
'''
new_exec = '''    ''' + "'''" + '''- Personalized sends reuse the existing durable contact-card reservation table under a separate blinded per-chat variant key, keyed additionally by the trusted accepted-request identity. Automatic or canonical cards cannot suppress an explicit personalized request, a retried or replayed turn still collapses to one card, and a genuinely new request inside the window is admitted.
''' + "'''" + ''',
'''
if text.count(old_exec) != 1:
    raise RuntimeError("could not locate the stale exec-plan target")
text = text.replace(old_exec, new_exec, 1)

path.write_text(text)
runpy.run_path(str(path), run_name="__main__")
