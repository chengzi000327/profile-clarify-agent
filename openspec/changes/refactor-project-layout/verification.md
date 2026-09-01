# Implementation verification

## Migration baseline

- Git branch: `codex/refactor-frontend-workbench`
- Git commit: `05b98711a6f4bd12ffc19e7f501045a56deb1e13`
- Remote divergence after fetch: `0 ahead / 0 behind`
- Railway project: `profile-clarify-agent` (`1495d78e-5f81-4f24-a8be-a6ebb7c96b0c`)
- Railway environment: `production` (`bcf81d63-4931-4462-bbff-8b9baeb80119`)

| Service | Service ID | Active deployment before migration | Dockerfile before migration | Status | Source revision evidence |
| --- | --- | --- | --- | --- | --- |
| `web` | `7ee1c480-2f5a-4a39-bbd8-1140a77f9aff` | `ac37992a-e0f7-484d-bd5b-db55744a5daf` | `/frontend/Dockerfile` | `SUCCESS` / `RUNNING` | CLI message records `05b9871` |
| `api` | `dca506eb-c437-4830-b15b-78bf41ef2f2d` | `3b39e2cf-281e-4fbf-a6a5-bd5403b01d20` | `/server/Dockerfile` | `SUCCESS` / `RUNNING` | Railway metadata does not expose a Git commit for this CLI deployment |
| `harness-sidecar` | `e1a28a02-bd60-45f5-9570-4118d1d541bd` | `0a1d0958-d18f-4150-a0f8-b8896a98b020` | `/harness-sidecar/Dockerfile` | `SUCCESS` / `RUNNING` | CLI message records rollback source `d6300bd`; Railway metadata does not expose a commit field |

Rollback requires restoring the corresponding old Dockerfile path before redeploying the recorded deployment/source revision. No Railway variables or secret values were read or recorded.

## Verification results

- Pre-migration `typecheck`: passed with pnpm `10.15.1`.
- Pre-migration `test`: passed; frontend 27, contracts 30, domain 4, sidecar 21, API 47 tests.
- Pre-migration `build`: passed for all workspace projects.
- Environment note: Homebrew Node 26 does not include `corepack`; checks use `npx --yes pnpm@10.15.1`, matching the repository `packageManager` exactly.
- Workspace migration: frozen lockfile installation and recursive package listing passed for all eight workspace projects.
- Layout check: passed; required directories exist and operational files contain no legacy root paths.
- Harness profile verification: passed for locked runtime `0.1.0-rc.5` at `47f943859bef60e4160492346772ded9b24f765a`.
- Path-bearing maintenance scripts: Node syntax checks passed and API dependency, migration, sidecar lock/config, and built protocol client targets exist at their new paths.
- Local Docker/Compose: unavailable on this machine (`docker`, `docker-compose`, Podman, Colima, Finch and desktop runtimes are absent). Production-equivalent Dockerfile validation must be completed by Railway builds and this limitation must remain in the delivery report.
- Compose fallback validation: Ruby YAML parsing passed and asserted the `api`, `harness-sidecar`, and `web` Dockerfile mappings exactly; this validates syntax/mapping but not image execution.
- Post-migration `layout:check`, `git diff --check`, `typecheck`, `test`, `build`, and Harness runtime smoke: passed after rebuilding application dependency links and correcting both moved TypeScript config roots.
- Review findings fixed: stale moved `node_modules` links, two `tsconfig.base.json` paths, an invalid pnpm-generated `allowBuilds` placeholder, and one Markdown trailing-space issue.
- Business source and database migrations: byte-for-byte comparisons against pre-migration paths found no content changes; only build/config/documentation paths changed.

## GitHub and Railway delivery

- GitHub implementation commit: `9968ef193ab8d603a78e9529265257241d8cb316`; remote branch matched after push.
- `harness-sidecar`: deployment `c6c8647e-50eb-4857-ad29-12de2157e4ba`, `/apps/harness-sidecar/Dockerfile`, `SUCCESS` / `RUNNING`.
- `api`: deployment `0e11d793-44f0-47ef-82fe-d49fd7207617`, `/apps/api/Dockerfile`, `SUCCESS` / `RUNNING`.
- `web`: deployment `201df445-b7c3-4844-9562-0d4b50554ef5`, `/apps/web/Dockerfile`, `SUCCESS` / `RUNNING`. The first upload attempt failed before creating a deployment; read-only confirmation preceded the successful retry.
- Public `/healthz`: HTTP 200 with `ok`; web root: HTTP 200 with the React root element.
- Manager, HR, and admin demo login, identity, approved-HC list, role-session list, and first role detail: HTTP 200.
- Permission boundary: manager and HR admin-run access returned 403; admin returned 200. Manager detail omitted HR-only candidate/calibration collections; HR/admin detail included them.
- Artifact chain: online API returned confirmed job-description and target-talent stages; browser smoke opened the role workbench and rendered both “岗位说明” and “目标人才画像”.
- Existing production data contains 11 approved HC rows rather than the README's original 10-row baseline because an additional historical demo HC is present. No data was added, deleted, or edited during this change.
- PostgreSQL service and volume were not rebuilt or changed. No migration file content changed; API startup only ran the existing idempotent migration command.

## OpenSpec verification

| Dimension | Result |
| --- | --- |
| Completeness | 17/17 implementation tasks complete; behavioral specs intentionally skipped for this pure refactor. |
| Correctness | Directory, workspace, scripts, Docker paths, three Railway builds, health checks, artifacts, and permission boundaries are covered by recorded evidence. |
| Coherence | Implementation follows the approved `apps/` mapping, keeps service/package contracts unchanged, and introduces no legacy compatibility paths or unrelated business changes. |

Final assessment: no CRITICAL, WARNING, or SUGGESTION issues remain. The local Docker limitation is explicitly covered by Compose YAML assertions and successful Railway builds for all three production Dockerfiles.
