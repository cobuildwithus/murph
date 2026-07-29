from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"{label} did not match expected PR head")
    return text.replace(old, new, 1)


service_path = Path("apps/web/src/lib/hosted-privacy/account-data-service.ts")
service = service_path.read_text()
coverage_anchor = '''  {
    slug: "prisma.hosted_member_routing",
    label: "Linq, Telegram, reply-alias routing bindings",
    deletion: "live-delete",
    note: "Confirmed export includes decrypted user-facing Linq and Telegram routing IDs and pending Linq participant contacts while omitting lookup keys used for inbound traffic matching.",
  },
'''
coverage_entry = '''  {
    slug: "prisma.hosted_pending_group_setup",
    label: "Encrypted pending next-group setup",
    deletion: "live-delete",
    note: "Deletes the member's short-lived encrypted next-group style and room-context intent before routing and identity rows. Export reports only row counts and never exposes the blinded line key, ciphertext, or decoded setup.",
  },
'''
if coverage_entry not in service:
    service = replace_once(
        service,
        coverage_anchor,
        coverage_anchor + coverage_entry,
        "account-data coverage entry",
    )
delete_anchor = '''  record("prisma.hosted_member_routing", await input.prisma.hostedMemberRouting.deleteMany({ where: { memberId: memberIdFilter } }));
'''
delete_entry = '''  record("prisma.hosted_pending_group_setup", await input.prisma.hostedPendingGroupSetup.deleteMany({
    where: { ownerMemberId: memberIdFilter },
  }));
'''
if delete_entry not in service:
    service = replace_once(
        service,
        delete_anchor,
        delete_entry + delete_anchor,
        "pending setup account deletion",
    )
service_path.write_text(service)


test_path = Path("apps/web/test/hosted-account-data-service.test.ts")
tests = test_path.read_text()
tests = replace_once(
    tests,
    '''  "prisma.hosted_member_routing",
  "prisma.hosted_member_email_authorization",
''',
    '''  "prisma.hosted_member_routing",
  "prisma.hosted_pending_group_setup",
  "prisma.hosted_member_email_authorization",
''',
    "required account-data store slug",
)
account_test = '''  it("deletes pending next-group setup before member routing", async () => {
    const operationOrder: string[] = [];
    const prisma = createHostedAccountDeletionPrismaForTest({
      onTransaction: () => undefined,
      operationOrder,
    });

    const result = await deleteHostedAccountData({
      memberId: "member_123",
      prisma,
      request: new Request("https://join.example.test/settings"),
    });

    expect(operationOrder.indexOf("delete:hostedPendingGroupSetup"))
      .toBeLessThan(operationOrder.indexOf("delete:hostedMemberRouting"));
    expect(result.deletedCounts["prisma.hosted_pending_group_setup"]).toBe(1);
  });

'''
account_test_anchor = '''  it("preempts a pending dispatch instead of stranding the deletion", async () => {
'''
if account_test not in tests:
    tests = replace_once(
        tests,
        account_test_anchor,
        account_test + account_test_anchor,
        "pending setup account deletion test",
    )
test_path.write_text(tests)


concurrency_path = Path("apps/web/test/hosted-pending-group-setup-postgres-concurrency.test.ts")
concurrency = concurrency_path.read_text()
cascade_anchor = '''        expect(await observer.hostedPendingGroupSetup.count({
          where: { ownerMemberId },
        })).toBe(0);

        await observer.hostedMember.delete({ where: { id: ownerMemberId } });
        expect(await observer.hostedPendingGroupSetup.count({
          where: { ownerMemberId },
        })).toBe(0);
'''
cascade_proof = '''        expect(await observer.hostedPendingGroupSetup.count({
          where: { ownerMemberId },
        })).toBe(0);

        await observer.$transaction((tx) => armHostedPendingGroupSetupTx({
          now: new Date("2026-07-29T18:06:00.000Z"),
          ownerMemberId,
          setup: {
            roomContextMarkdown:
              "Replacement state should cascade with the member.",
            style: { personality: { detail: 2, humor: 1 } },
          },
          tx,
        }));
        expect(await observer.hostedPendingGroupSetup.count({
          where: { ownerMemberId },
        })).toBe(1);

        await observer.hostedMember.delete({ where: { id: ownerMemberId } });
        expect(await observer.hostedPendingGroupSetup.count({
          where: { ownerMemberId },
        })).toBe(0);
'''
concurrency = replace_once(
    concurrency,
    cascade_anchor,
    cascade_proof,
    "live pending setup cascade proof",
)
concurrency_path.write_text(concurrency)
