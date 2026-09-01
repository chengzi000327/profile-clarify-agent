## Purpose

保证岗位产物版本、下游失效状态、岗位当前状态与审计记录始终作为一个一致业务变更提交，避免失败或并发写入向用户暴露部分更新和错误版本。

## ADDED Requirements

### Requirement: Artifact lifecycle changes are atomic
The system SHALL commit every artifact generation or confirmation as one atomic lifecycle change covering all new artifact versions, affected existing artifacts, the role state and any decision audit required by that action.

#### Scenario: Draft generation succeeds completely
- **WHEN** an authorized artifact generation completes against the current role revision
- **THEN** the new artifact version, all downstream invalidations and the role's latest artifact references and revision are committed together

#### Scenario: Confirmation succeeds completely
- **WHEN** an authorized user confirms the current draft using the current content hash and role revision
- **THEN** the confirmed or locked artifact, the resulting role stage and revision, and the confirmation decision audit are committed together

#### Scenario: A lifecycle write fails
- **WHEN** any required write within artifact generation or confirmation cannot be completed
- **THEN** none of the writes belonging to that lifecycle change become visible and the previously committed role and artifact state remains authoritative

### Requirement: Concurrent artifact changes preserve a single version history
The system SHALL accept an artifact lifecycle change only when it is based on the current persisted role revision and SHALL reject stale competing changes without partially applying them.

#### Scenario: Two requests use the same role revision
- **WHEN** two artifact lifecycle changes compete using the same persisted role revision
- **THEN** at most one change commits and the other returns the existing revision-conflict behavior without creating a duplicate or orphan artifact version

#### Scenario: Generated version is calculated from the locked role history
- **WHEN** a new artifact version is committed
- **THEN** its version is the next version for that artifact type in the accepted role history and the role's latest artifact reference points to that version

### Requirement: Store implementations obey the same lifecycle contract
The system SHALL expose equivalent observable lifecycle behavior when using the in-memory store for tests and the PostgreSQL store for deployed environments.

#### Scenario: Contract suite exercises a successful lifecycle change
- **WHEN** the shared storage contract runs against either supported store
- **THEN** both stores expose the same committed role revision, artifact versions, invalidation statuses and decision audit

#### Scenario: Contract suite exercises a rejected lifecycle change
- **WHEN** the shared storage contract causes a stale or invalid lifecycle change to be rejected
- **THEN** both stores preserve the same pre-change snapshot without partial writes

### Requirement: Existing clients remain compatible
The system SHALL preserve the existing artifact API paths, request and response shapes, role permissions, content schemas and user-visible stage transitions.

#### Scenario: Existing web client generates or confirms an artifact
- **WHEN** the current web client calls an artifact generation or confirmation endpoint
- **THEN** it receives the same success or domain-error shape it relied on before this change

