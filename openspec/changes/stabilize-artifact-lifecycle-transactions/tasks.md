## 1. Transaction Contract

- [x] 1.1 Add the narrow artifact lifecycle commit input/result types and shared invariant validation to the store boundary; verify unit tests reject wrong role ownership, tenant changes, non-sequential revisions and invalid artifact updates.
- [x] 1.2 Add a reusable store contract suite covering complete commit, downstream invalidation, decision audit, stale revision rejection and rollback; verify the suite runs against MemoryStore in the normal API test command.

## 2. Store Implementations

- [x] 2.1 Implement MemoryStore lifecycle commits with copy-on-write semantics; verify the shared contract proves failed commits leave the aggregate and decisions unchanged.
- [x] 2.2 Implement PostgresStore lifecycle commits with a role-row lock and one database transaction; verify artifact/state/audit writes use the transaction handle and affected rows are role-scoped and checked.
- [x] 2.3 Wire the shared contract to an explicitly isolated `TEST_DATABASE_URL`, refuse the production URL, and run it when an isolated database is available; verify the result or record the unavailable environment without touching production data.

## 3. Application Integration

- [x] 3.1 Route artifact draft generation, including downstream invalidation, through one lifecycle commit; verify API tests preserve version progression, latest-artifact projection and existing revision-conflict responses.
- [x] 3.2 Route job-description locking and ordinary artifact confirmation, including `CONFIRM_ARTIFACT` audits, through one lifecycle commit; verify tests prove state, artifact and audit are committed or rolled back together.
- [x] 3.3 Search artifact lifecycle callers and remove only the superseded sequential writes; verify permissions, tenant filtering, content hashes, stages and API request/response schemas remain unchanged.

## 4. Review, Delivery and Deployment

- [x] 4.1 Review the actual diff for transaction gaps, cross-role/tenant access, concurrency, rollback, migration and sensitive-data risks; fix all blocking findings and verify `git diff --check` is clean.
- [x] 4.2 Run API tests plus repository `typecheck`, `test` and `build`; verify all checks pass and explicitly record any isolated PostgreSQL check that could not run.
- [x] 4.3 Fetch and fast-forward the latest remote branch, confirm the verified diff contains no unrelated files or migration, commit and push to GitHub, and verify the remote branch contains the recorded commit hash.
- [ ] 4.4 Deploy only Railway `api` from that exact commit and verify API health, login, role list/detail, manager/admin artifact generation-confirmation, HR visibility boundaries, and compatibility with the existing `web` and `harness-sidecar`; record deployment IDs, service status, smoke results and rollback commit.
