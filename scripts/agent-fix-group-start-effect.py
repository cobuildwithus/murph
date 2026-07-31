# Trigger the finalization workflow after the manual PR audit.
from pathlib import Path

path = Path("apps/web/src/components/hosted-groups/group-start-client.tsx")
content = path.read_text()


def replace_once(before: str, after: str, label: str) -> None:
    global content
    count = content.count(before)
    if count != 1:
        raise RuntimeError(f"{label}: expected one anchor, found {count}")
    content = content.replace(before, after, 1)


replace_once(
    '''  const recoveryStarted = useRef(false);
  const [authOpen, setAuthOpen] = useState(!authenticated);
  const [signedIn, setSignedIn] = useState(authenticated);
  const [readyAccess, setReadyAccess] = useState(activeAccess);
  const [recoveryToken, setRecoveryToken] = useState<string | null>(null);
  const [recoveryStatus, setRecoveryStatus] =
    useState<HostedGroupStartRecoveryStatus>("checking");''',
    '''  const recoveryStarted = useRef(false);
  const recoveryTokenRef = useRef<string | null>(null);
  const [authOpen, setAuthOpen] = useState(!authenticated);
  const [signedIn, setSignedIn] = useState(authenticated);
  const [readyAccess, setReadyAccess] = useState(activeAccess);
  const [recoveryStatus, setRecoveryStatus] =
    useState<HostedGroupStartRecoveryStatus>("checking");''',
    "replace recovery token state with a ref",
)

replace_once(
    '''  useEffect(() => {
    if (activeAccess) {
      clearHostedGroupStartHandoff();
    } else {
      armHostedGroupStartHandoff();
    }

    const token = readHostedGroupStartRecoveryToken();
    setRecoveryToken(token);
    if (!token || !authenticated) {
      setRecoveryStatus("idle");
      return;
    }
    if (recoveryStarted.current) {
      return;
    }

    recoveryStarted.current = true;
    setRecoveryStatus("linking");
    void linkRecovery(token).then(
      () => {
        clearHostedGroupStartRecoveryFragment();
        setRecoveryStatus("linked");
      },
      () => setRecoveryStatus("failed"),
    );
  }, [activeAccess, authenticated]);''',
    '''  useEffect(() => {
    if (activeAccess) {
      clearHostedGroupStartHandoff();
    } else {
      armHostedGroupStartHandoff();
    }

    let cancelled = false;
    const token = readHostedGroupStartRecoveryToken();
    recoveryTokenRef.current = token;

    void Promise.resolve().then(async () => {
      if (cancelled) {
        return;
      }
      if (!token || !authenticated) {
        setRecoveryStatus("idle");
        return;
      }
      if (recoveryStarted.current) {
        return;
      }

      recoveryStarted.current = true;
      setRecoveryStatus("linking");
      try {
        await linkRecovery(token);
        if (!cancelled) {
          clearHostedGroupStartRecoveryFragment();
          setRecoveryStatus("linked");
        }
      } catch {
        if (!cancelled) {
          setRecoveryStatus("failed");
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeAccess, authenticated]);''',
    "move recovery state transitions behind an async boundary",
)

replace_once(
    '''  async function handleCompleted(payload: HostedPrivyCompletionPayload) {
    if (recoveryToken) {
      setRecoveryStatus("linking");
      try {
        await linkRecovery(recoveryToken);''',
    '''  async function handleCompleted(payload: HostedPrivyCompletionPayload) {
    const recoveryToken = recoveryTokenRef.current;
    if (recoveryToken) {
      setRecoveryStatus("linking");
      try {
        await linkRecovery(recoveryToken);''',
    "read completion recovery token from the ref",
)

replace_once(
    '''          onClick={() => {
            if (!recoveryToken) {
              return;
            }
            setRecoveryStatus("linking");
            void linkRecovery(recoveryToken).then(''',
    '''          onClick={() => {
            const recoveryToken = recoveryTokenRef.current;
            if (!recoveryToken) {
              return;
            }
            setRecoveryStatus("linking");
            void linkRecovery(recoveryToken).then(''',
    "read retry recovery token from the ref",
)

path.write_text(content)

handoff_test_path = Path("apps/web/test/hosted-group-start-handoff.test.ts")
handoff_test = handoff_test_path.read_text()
old_handoff_assertions = '''    expect(consumeHostedGroupStartHandoff({
      now: new Date("2026-07-31T05:00:00.000Z"),
      storage,
    })).toBe(true);
    expect(consumeHostedGroupStartHandoff({
      now: new Date("2026-07-31T05:00:00.000Z"),
      storage,
    })).toBe(false);'''
new_handoff_assertions = '''    expect(consumeHostedGroupStartHandoff({
      now: new Date("2026-07-31T04:15:00.000Z"),
      storage,
    })).toBe(true);
    expect(consumeHostedGroupStartHandoff({
      now: new Date("2026-07-31T04:15:00.000Z"),
      storage,
    })).toBe(false);'''
if handoff_test.count(old_handoff_assertions) != 1:
    raise RuntimeError("handoff test: expected one 24-hour fixture anchor")
handoff_test_path.write_text(
    handoff_test.replace(old_handoff_assertions, new_handoff_assertions, 1),
)
