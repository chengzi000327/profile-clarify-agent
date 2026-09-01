## Context

See `proposal.md` for motivation and `specs/artifact-lifecycle-consistency/spec.md` for required behavior. `RoleService` currently builds artifact and role-state changes in memory, then calls several independent `ApplicationStore` methods. PostgreSQL already has a unique `(role_session_id, type, version)` constraint and uses transactions for aggregate creation, but artifact lifecycle writes are not grouped. MemoryStore mutates its maps method by method, so it can also expose partial state if a later operation fails.

The API currently uses optimistic role revisions. Artifact generation does not receive a revision from the browser, but it reads a role snapshot immediately before persisting the generated result; confirmation receives and validates `expected_revision`. The design must preserve those public semantics and must not run destructive tests against production data.

## Goals / Non-Goals

**Goals:**

- Introduce one narrow persistence operation for an already-authorized artifact lifecycle commit.
- Make the current artifact rows, next role state and confirmation audit atomic in both supported stores.
- Use the role revision as the concurrency boundary and retain existing `REVISION_CONFLICT` behavior.
- Prove store equivalence with a reusable contract suite, including rollback and concurrent/stale-write behavior.

**Non-Goals:**

- Generalize every store operation into repositories or a generic unit-of-work framework.
- Move authorization or artifact content validation into persistence.
- Change route schemas, artifact schemas, role stages, database tables or Railway topology.
- Make Agent Run execution durable or split `RoleService` in this change.

## Decisions

### 1. Add a narrow artifact lifecycle commit command

Add an `ArtifactLifecycleCommit` value to the store contract containing:

- `role_session_id` and `expected_revision`;
- the complete next `RoleState`;
- artifacts to insert;
- existing artifacts to update, restricted to the same role;
- decision audit records required by the action.

The store returns whether the expected revision was accepted. `RoleService` continues to perform access checks, content validation, hash validation, dependency validation and construction of domain values. It submits the final mutation once and maps a rejected revision to the existing domain conflict.

This is preferred over `transaction(callback)` because it does not leak Drizzle transaction objects into the application layer or turn all 40+ store methods into transaction-aware variants. It is preferred over a generic repository abstraction because only the demonstrated artifact lifecycle needs a multi-record atomic boundary now.

### 2. PostgreSQL locks and validates the role before writing

`PostgresStore` executes the commit in one database transaction. It selects the target role row `FOR UPDATE`, verifies the persisted revision equals `expected_revision`, validates that the supplied next state increments that revision exactly once, and only then applies artifact updates/inserts, role-state update and decision inserts.

Artifact updates are constrained by both artifact ID and role session ID and must affect exactly one row. Inserted artifacts must belong to the target role. Existing unique version constraints remain the last line of defence; no schema migration is needed.

The version is still constructed from the aggregate loaded by `RoleService`, but the locked revision check guarantees that no accepted competing lifecycle change has altered that history between read and commit. A unique-constraint failure or any other write error rolls the transaction back.

### 3. MemoryStore uses copy-on-write for the same command

MemoryStore validates the same revision and role ownership rules against a cloned aggregate. It applies every mutation and decision to the clone/local arrays first, then swaps the committed aggregate and appends audits only after all validation succeeds. This gives tests rollback semantics instead of relying on a sequence of mutating calls.

The old single-record store methods remain for unrelated use cases during this focused change. Artifact lifecycle paths stop using them directly; later API modularization can reconsider their visibility.

### 4. Confirmation audits move inside the lifecycle commit

Both ordinary artifact confirmation and the intermediate job-description lock currently update artifacts/state before appending the audit. They will construct the existing `CONFIRM_ARTIFACT` decision record before commit and include it in the atomic command. Audit fields and externally visible trace behavior remain unchanged.

Draft generation currently has no decision audit, so its command contains no decision records. No new audit category is invented.

### 5. Use one store contract with an explicitly isolated PostgreSQL database

Create a factory-driven contract suite that can run against MemoryStore and PostgresStore. The mandatory in-memory suite runs in the normal test command. The PostgreSQL variant runs only when an explicit isolated `TEST_DATABASE_URL` is supplied; it must refuse a URL that is identical to `DATABASE_URL` and clean only records created under its unique test tenant/role identifiers.

The contract covers successful atomic commits, downstream invalidation, decision persistence, stale revision rejection and rollback after an invalid artifact update. Existing API tests continue to cover permissions and response compatibility. Deployment verification uses normal API smoke tests and does not repurpose production PostgreSQL as a destructive test database.

## Risks / Trade-offs

- [The commit payload can contain inconsistent next state] → Validate role ID, tenant-preserving state, exact revision increment, artifact ownership and affected-row counts inside both stores before committing.
- [A database error is exposed as a generic 500 rather than a revision conflict] → Detect the locked revision mismatch before writes and retain the existing conflict mapping; unexpected constraint failures remain errors and roll back safely.
- [MemoryStore and PostgreSQL validation drift] → Centralize pure commit-shape validation where practical and execute the same factory-driven contract cases against both adapters.
- [PostgreSQL contract tests are skipped locally] → Require an explicit isolated test URL, report when unavailable, and run production deployment checks separately without mutating production fixtures.
- [The narrow command leaves other multi-write workflows non-atomic] → Keep scope limited to the approved core artifact lifecycle; candidate calibration and policy changes require separate evidence and OpenSpec changes.

## Migration Plan

1. Add the commit contract and shared validation without changing callers.
2. Implement and contract-test MemoryStore, then PostgreSQL.
3. Route draft generation and both confirmation branches through the new command; remove their sequential artifact/state/audit writes.
4. Run API tests, typecheck, full repository tests and build. Run the PostgreSQL contract against an isolated database when available.
5. Review the final diff for permission, tenant, version, migration and rollback impact; confirm no schema migration exists.
6. Pull/fetch the target branch again, commit and push the verified change, then deploy only Railway `api` at that exact commit.
7. Verify generation, confirmation, rollback and concurrent-write behavior with the complete automated API/store suite. In production, use read-only smoke checks for API health, manager/HR/admin login, role list/detail, HR visibility boundaries and admin Trace, then confirm `web` and `harness-sidecar` remain healthy. Do not create production artifact versions solely for deployment verification.

Rollback is an API redeploy to the preceding commit. Because no schema migration or data rewrite is introduced, no database rollback is required; already committed lifecycle transactions remain valid.
