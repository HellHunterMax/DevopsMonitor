# Squad Decisions

## Active Decisions

### 2026-08-28: Production readiness review for DevopsMonitor extension
**By:** Rusty
**What:** Verdict: **not ready for production use yet**.
**Why:** The MV3 foundation is sound, but the current implementation still has core state-identity and failure-handling gaps that will mislead real users and make support difficult.

#### What I checked
- `PLAN.md`
- `src/manifest.json`
- `src/background/{service-worker.ts,poller.ts,state.ts,notifier.ts}`
- `src/popup/popup.ts`
- `src/options/options.ts`
- `src/api/{ado-client.ts,approvals.ts,pipelines.ts}`
- `src/utils/{storage.ts,url-builder.ts}`
- `src/types/ado.ts`
- Validation: `npm run build` ✅

#### Verdict details

##### Blocker — monitoring identity is inconsistent with the design
- `PLAN.md` says `pipeline_configs` is “one per monitored build” and popup State A applies when the **current build** is being monitored.
- The code stores `lastBuildId`, but popup active-state lookup ignores it and matches only `pipelineId + project` (`src/popup/popup.ts`).
- Snapshot storage is keyed only by `pipelineId` (`src/background/state.ts`, `src/types/ado.ts`), not by org/project/build.
- Result: if build 123 is monitored and the user opens build 124 of the same pipeline, the popup can incorrectly show “Monitoring active” even though polling is still pinned to build 123. Pipelines with the same numeric ID in different projects can also collide in snapshot state.

##### Blocker — user-facing failures are mostly silent
- Popup context loading sets “Loading build info...”, but on any fetch/auth/schema failure it logs and returns `false`, then the caller clears status (`src/popup/popup.ts`). A real user gets no actionable explanation for invalid PATs, network failures, or malformed responses.
- `FORCE_POLL` in the service worker logs errors but does not send an error response (`src/background/service-worker.ts`), so “Poll Now” can fail without a clear UI message.
- `AdoClient.get` throws on HTTP errors but gives no normalized handling for malformed JSON (`src/api/ado-client.ts`).

##### Major — approval capability is not truly validated
- The options page “Test Connection” only calls `/_apis/projects` (`src/options/options.ts`), so a PAT can test green while still lacking the approvals capability needed for `/_apis/pipelines/approvals`.
- `getPendingApprovals` intentionally degrades to `[]` on failure (`src/api/approvals.ts`). That is acceptable as a fallback, but combined with the shallow connection test it means approval notifications can quietly never work in production.

##### Major — storage writes are race-prone and there is no migration story
- Storage helpers use blind read-modify-write arrays (`src/utils/storage.ts`, `src/background/state.ts`).
- Overlapping poll runs, popup edits, and options-page edits can stomp each other’s writes or duplicate notifications.
- There is no schema version key, migration hook, or compatibility layer. If `PipelineConfig`, snapshots, or notification metadata changes after shipping, existing installs have no upgrade path.

##### Major — storage growth/cleanup is unfinished
- `notification_map` is append-only in practice; clicking a notification clears the toast but does not remove the stored mapping (`src/background/notifier.ts`).
- Snapshots are not cleared consistently when monitoring is removed from every UI path.
- `dismissed_builds` is permanent until manually cleared.
- None of this will hurt day one, but long-lived installs can accumulate stale state without any retention policy.

##### Minor — PLAN.md is close, but not perfectly “as built”
- MV3 alarm usage matches the plan and permissions are lean: `storage`, `notifications`, `alarms`, `tabs`, plus host access only to `https://dev.azure.com/*` (`src/manifest.json`).
- The notable drift is behavioral, not structural: popup State A semantics do not actually match the plan’s “this build is monitored” claim, and `background/state.ts` does not manage `pipeline_configs` the way the file-structure note suggests.

#### Production-readiness call
Do **not** ship this as production-ready yet. Fix the blockers first:
1. Make monitored state identity explicit: key configs/snapshots by org + project + pipelineId + monitored buildId, then make popup State A/B/C use the same identity.
2. Turn network/auth failures into user-visible states in popup/options, and always resolve/reject message flows cleanly.
3. Add storage versioning + migration handling before the first public release.
4. Add cleanup/retention for notification metadata and stale snapshots.

#### Nice-to-have later (Phase 2/3 territory)
- Badge/status polish from `PLAN.md`
- Short-lived API caching
- Stronger PAT capability checks with explicit approval-feature validation
- Lightweight automated tests around URL parsing, storage migrations, and poll change-detection

### 2026-08-28: Production readiness review of src tree
**By:** Basher
**What:** Completed a full code quality, security, permissions, input-validation, and build-health review of the extension's `src/` tree. Verdict: **NOT READY** for production.
**Why:** The manifest is reasonably minimal and the TypeScript build is clean, but there are two production-blocking security issues: extension-context DOM XSS in the popup and PAT reuse against whatever Azure DevOps org is open in the active tab rather than the configured org.

**Verdict:** **NOT READY**

**Validation performed**
- `npm run build` ✅ (webpack production build succeeded)
- `npx tsc --noEmit` ✅
- `tsconfig.json` has `"strict": true`

**What looks good**
- `src/manifest.json` is close to minimal as implemented: `storage`, `notifications`, `alarms`, and `tabs` are all exercised in `src/utils/storage.ts`, `src/background/service-worker.ts`, `src/background/notifier.ts`, and `src/popup/popup.ts`.
- `host_permissions` is narrowed to `https://dev.azure.com/*`; no `vsrm.dev.azure.com` references remain under `src/`.
- I found no PAT logging and no TypeScript `any` usage in `src/`.

## Findings

### [blocker] Popup injects remote/user-controlled data into extension DOM via `innerHTML`
**Evidence:** `src/popup/popup.ts:38-41`, `80-81`, `102-103`, `124-125` interpolate `config.pipelineName`, `config.project`, watched stage names, and branch names directly into `innerHTML`.

**Why it matters:** Those values ultimately come from Azure DevOps responses and the current tab URL context. If a pipeline/project/stage/branch name contains HTML, this can execute script inside the extension popup. In extension context, that becomes credential theft risk because the popup can access `chrome.storage.local`, including the saved PAT.

**Fix direction:** Stop using `innerHTML` for untrusted values. Build DOM with `textContent` / `createElement`, or centrally escape every interpolated field before insertion.

### [blocker] The saved PAT is sent to the org from the active tab, not strictly the configured org
**Evidence:** `src/popup/popup.ts:171-179` reads the active tab URL, parses it with `parseAdoBuildUrl`, then creates `new AdoClient(ctx.orgUrl, pat)`. `src/utils/storage.ts:3-10` stores one PAT globally, not per-org.

**Why it matters:** The review question was whether the PAT is ever sent anywhere besides the configured ADO org. In popup context flow, the answer is yes: if the user opens a different `https://dev.azure.com/{org}` build page, the extension will reuse the stored PAT against that tab's org URL. Even if the token later fails auth, it has still been transmitted to a different org endpoint than the one the user configured.

**Fix direction:** Bind credentials to a validated org identity and refuse cross-org reuse. Either store credentials per org and require an exact match, or block popup monitoring when `ctx.orgUrl !== saved.orgUrl`.

### [major] Organization URL input is not validated or normalized before storage/use
**Evidence:** `src/options/options.ts:148-177` trims raw input and saves it; `src/utils/storage.ts:9-10` persists it unchanged; `src/api/ado-client.ts:14-16` uses the resulting URL directly for authenticated fetches.

**Why it matters:** The code relies on user discipline and manifest policy instead of enforcing a safe URL shape. There is no check for `https`, no canonicalization, no rejection of extra path/query/userinfo, and no exact `dev.azure.com/{org}` allowlist at save time.

**Fix direction:** Parse with `new URL()`, require `https`, require hostname `dev.azure.com`, require exactly one org path segment for saved org URLs, strip trailing slash, and reject anything else before save/test.

### [major] PAT is stored in plaintext in `chrome.storage.local` and rehydrated into the options page
**Evidence:** `src/utils/storage.ts:4-10` reads/writes `ado_pat` directly in `chrome.storage.local`; `src/options/options.ts:143-144` repopulates the saved PAT into the password field on load.

**Why it matters:** This is workable for a prototype, but it is not a hardened production secret-handling story. Anyone who gains extension-context execution (see blocker above) or local profile access gets the token directly. Rehydrating it into the DOM also increases the blast radius of any UI compromise.

**Fix direction:** At minimum, document this as an explicit security tradeoff and avoid echoing the stored PAT back into the DOM. For stronger hardening, reduce residency time (session-only storage / re-entry) or integrate a safer secret-handling approach if your platform constraints allow it.

### [minor] Approval payloads are dumped to console in production code
**Evidence:** `src/api/approvals.ts:10-12` logs approval counts and full approval objects via `JSON.stringify(results, null, 2)`.

**Why it matters:** This is noisy and may expose approver names / workflow metadata unnecessarily in browser logs. It is not a PAT leak, but it is still avoidable production data exposure.

**Fix direction:** Remove the full-object log or gate it behind a debug flag.

### [minor] `notification_map` grows without cleanup
**Evidence:** `src/background/notifier.ts:35-37` stores every notification URL; `src/background/notifier.ts:49-53` clears the OS notification on click but never deletes the corresponding map entry.

**Why it matters:** This is dead state accumulation in persistent storage and can grow indefinitely over time.

**Fix direction:** Delete `map[notificationId]` and persist the pruned map after click/clear.

### [minor] `FORCE_POLL` failure path does not send a response
**Evidence:** `src/background/service-worker.ts:33-39` sends a response on success, but `.catch(console.error)` does not call `sendResponse` with an error payload.

**Why it matters:** The popup's `await chrome.runtime.sendMessage({ type: 'FORCE_POLL' })` can fail without a structured error response, which makes troubleshooting and UI feedback weaker.

**Fix direction:** Return `{ ok: false, error }` on failure and surface that in the popup.

### 2026-08-28: Production testing readiness assessment
**By:** Livingston
**What:** Assessed the current automated and manual test readiness for shipping the DevopsMonitor extension. Verdict: **not ready** for production.
**Why:** There is no runnable automated test suite, no coverage harness, and the highest-risk logic paths are completely untested. A production ship right now would rely almost entirely on ad hoc manual checking.

## Verdict

**Not ready**

## Evidence

- `package.json` has no `test` script.
- `npm test` failed immediately with `Missing script: "test"`.
- Discovered automated test count: **0 passing / 0 failing / 1 test command failure**.
- No `tests/`, `__tests__/`, `*.test.*`, `*.spec.*`, Jest config, or Vitest config found in the repo.
- `npm run build` **passed**, so the code currently compiles and bundles, but that is build validation, not behavior validation.

## What is covered today

- **Build-only coverage**
  - TypeScript compilation and webpack bundling of:
    - `src/background/service-worker.ts`
    - `src/background/poller.ts`
    - `src/background/notifier.ts`
    - `src/popup/popup.ts`
    - `src/options/options.ts`
    - `src/api/*.ts`
    - `src/utils/*.ts`
- That build pass gives limited confidence that imports, types, and bundle entry points are valid.

## What is not covered today

- **No automated behavioral coverage at all** for:
  - `src/background/poller.ts`
  - `src/background/state.ts`
  - `src/utils/url-builder.ts`
  - `src/utils/storage.ts`
  - `src/popup/popup.ts`
  - `src/background/service-worker.ts`
  - `src/background/notifier.ts`
  - `src/api/ado-client.ts`
  - `src/api/pipelines.ts`
  - `src/api/approvals.ts`
  - `src/options/options.ts`

## Findings

### [blocker] No runnable automated test suite exists

- There is no `npm test` entry and no test runner configuration.
- Production readiness cannot be claimed when critical polling, storage, and popup state logic have zero executable tests.

### [blocker] Poller/state-change detection has zero protection despite being the highest-risk path

- `src/background/poller.ts` contains the core notification decision logic:
  - pinned-build vs latest-build fallback
  - stage filtering by configured stage name
  - approval detection via approvals API + timeline fallback
  - transition detection for completion and approval notifications
  - snapshot persistence across poll cycles
- `src/background/state.ts` is also untested, so snapshot read/write behavior is unverified.
- This is the code most likely to spam, miss, or duplicate notifications, and there are no tests proving otherwise.

### [blocker] Context-aware popup state machine is untested

- `src/popup/popup.ts` drives the user-facing A/B/C states:
  - already monitored
  - dismissed build
  - stage picker
- No tests verify URL-context detection, stage selection behavior, monitored-list rendering, dismiss/undismiss flow, forced poll flow, or poll status timing updates.

### [major] URL parsing/building logic has no regression coverage

- `src/utils/url-builder.ts` has no tests for:
  - non-ADO URLs
  - malformed URLs
  - missing `buildId`
  - non-numeric `buildId`
  - encoded org/project names
  - unexpected pathname shapes
  - trailing slash/query noise in build URLs
- If this breaks, the popup silently loses its context-aware behavior.

### [major] Storage helpers have no tests, including failure paths

- `src/utils/storage.ts` has no mocked `chrome.storage.local` coverage for:
  - missing keys / default fallbacks
  - duplicate dismiss protection
  - undismiss behavior
  - snapshot overwrite vs append behavior
  - last-polled timestamp persistence
  - rejected `chrome.storage.local.set/get/remove` calls
  - storage quota / write failure scenarios

### [major] API error handling is only partially defensive and entirely untested

- `src/api/ado-client.ts` throws on non-OK HTTP responses, but there are no tests around:
  - 401/403 invalid or expired PAT
  - 404 build/timeline not found
  - 429 throttling
  - non-JSON or malformed JSON responses
- `src/api/approvals.ts` intentionally swallows approvals API failures, but that degraded mode has no tests.
- `src/background/poller.ts` assumes usable response shapes for build/timeline/approval data and has no tests for malformed ADO payloads.

### [major] Concurrency/reentrancy risk is untested

- `src/background/service-worker.ts` can trigger `runPoll()` from:
  - `onInstalled`
  - `onAlarm`
  - `FORCE_POLL`
- There is no locking/debounce behavior and no tests for overlapping poll executions, concurrent alarm firing, duplicate notification suppression under overlap, or write ordering to snapshots / `last_polled_at`.

### [minor] Notification click flow and cleanup are untested

- `src/background/notifier.ts` has no tests for:
  - notification map persistence
  - duplicate IDs overwriting older entries
  - click opening the correct build URL
  - stale map entries after click/clear

### [minor] Options-page smoke behavior is also untested

- `src/options/options.ts` lacks tests for:
  - empty credential validation
  - connection success/failure rendering
  - clearing credentials/pipelines/snapshots/dismissed builds
  - escaping displayed values in the storage overview

## Missing edge cases that need explicit coverage

### Poller / background

- network timeout / fetch rejection
- approvals endpoint unavailable while timeline still works
- build fetch fails for pinned build, then latest-build fallback succeeds
- both pinned build fetch and latest-build fetch fail
- empty pipeline config list
- empty build list from `getBuilds()`
- timeline returns zero stage records
- stage names differ only by case
- stage result changes after already being marked completed
- approval appears without `stage.name`
- approval payload missing `pipeline.owner`
- overlapping `runPoll()` calls from alarm + manual force poll

### API/data-shape robustness

- malformed JSON
- `{ value: null }` or missing `value`
- timeline `{ records: null }` or missing `records`
- missing `definition`, `sourceBranch`, `order`, `name`, or `state`
- invalid/expired PAT (401/403)
- throttling / transient 5xx responses

### Storage

- `chrome.storage.local` read/write rejection
- quota exceeded / write failure
- corrupt persisted shapes (wrong types in `pipeline_configs`, `build_snapshots`, `dismissed_builds`)
- duplicate pipeline entries
- stale snapshot after monitored pipeline is removed/re-added

### Popup

- active tab is not an ADO build page
- active tab URL missing or inaccessible
- dismissed build reopening flow
- start monitoring with no selected stages
- removing monitored pipeline and immediately re-adding it
- poll status bar when `last_polled_at` is null / stale / updated during popup lifetime

## Manual-only QA gaps before shipping

These need a documented smoke checklist even after automated tests are added:

1. **Load-unpacked install**
   - Build `dist/`
   - Load extension in Chrome/Edge
   - Confirm manifest permissions and service worker register cleanly

2. **Options flow**
   - Save valid org URL + PAT
   - Test invalid / expired PAT
   - Confirm success and error messaging

3. **Real ADO page detection**
   - Open a real `dev.azure.com/.../_build/results?buildId=...` page
   - Confirm popup enters context mode and lists stages in build order

4. **Monitoring lifecycle**
   - Start monitoring a build
   - Dismiss a build, reopen popup, confirm dismissed state
   - Re-enable monitoring from dismissed state
   - Stop monitoring and confirm list updates

5. **Notification E2E**
   - Verify Windows notification appears for:
     - approval needed
     - stage success
     - stage failure
   - Click notification and confirm correct build page opens

6. **Background polling**
   - Confirm 30-second alarm wakes the service worker
   - Confirm manual “Poll Now” works without duplicate notifications
   - Confirm no notification spam across repeated polls with unchanged state

7. **Multi-pipeline / multi-stage behavior**
   - Monitor more than one pipeline
   - Monitor multiple stages in one pipeline
   - Confirm stage filtering works and unrelated stages do not notify

8. **Browser restart persistence**
   - Restart browser
   - Confirm credentials, monitored pipelines, dismissed builds, and snapshots behave as expected

### 2026-08-28: RAI production review of src tree
**By:** Rai
**What:** Reviewed `src/` for credential leaks, privacy/PII exposure, injection risks, polling abuse/rate-limit posture, and manifest permission minimization. Verdict: **🟡 Yellow**.
**Why:** No hardcoded secrets were found and manifest permissions are fairly tight, but there are still advisory production concerns around untrusted HTML rendering, unnecessary approver-data logging, and unthrottled polling behavior.

## Verdict

**🟡 Yellow**

Work can proceed, but I would not call this production-ready from an RAI/privacy posture until the items below are fixed.

## Findings

### [major] Untrusted strings are rendered with `innerHTML` in the privileged popup

**What**
- `src/popup/popup.ts:38-42` renders `config.pipelineName` and watched stage names with `item.innerHTML`.
- `src/popup/popup.ts:80-82` renders `pipelineName`, `project`, and watched stage names with `body.innerHTML`.
- `src/popup/popup.ts:124-126` renders `pipelineName` and `branch` with `header.innerHTML`.

**Why it matters**
- Those values come from Azure DevOps API responses or the active tab URL context, so they should be treated as untrusted.
- Even with MV3 CSP reducing straightforward script execution, injecting untrusted markup into an extension page is still the wrong trust boundary and can become credential-impacting if the popup ever gains a more directly exploitable sink.

**How to fix**
- Replace these `innerHTML` writes with DOM construction via `createElement` + `textContent`.
- If templating must remain, escape every interpolated value before insertion.

### [major] Approval payloads are logged verbatim, which can expose approver PII

**What**
- `src/api/approvals.ts:10-12` logs the full approvals payload with `JSON.stringify(results, null, 2)`.
- The payload schema explicitly includes approver `displayName` and `id` fields in `src/types/ado.ts:39-40`.

**Why it matters**
- This unnecessarily writes personal identifiers into extension logs when approvals exist.
- The review scope said PAT/org URL are expected; approver names and IDs are not necessary for the extension's runtime behavior.

**How to fix**
- Remove raw approval-object logging in production code.
- If diagnostics are needed, log only counts or redacted identifiers behind an explicit debug flag.

### [major] Polling has no backoff, no `429` handling, and no overlap guard

**What**
- `src/background/service-worker.ts:9,16,18,24,39` can trigger `runPoll()` on install, on every 30-second alarm, and on manual `FORCE_POLL`.
- `src/background/poller.ts:37-39` performs timeline + approvals requests per configured pipeline on each pass.
- `src/api/ado-client.ts:14-16` treats all non-OK responses the same and does not honor `Retry-After` or distinguish throttling.

**Why it matters**
- With multiple monitored pipelines, this produces a steady stream of ADO requests every 30 seconds.
- If a poll cycle runs long, or the user repeatedly clicks “Poll Now,” overlapping polls can stack without any single-flight lock.
- On throttling or transient failure, the extension immediately retries on the next schedule with no jitter/backoff, which is a poor abuse/rate-limit posture.

**How to fix**
- Add a single-flight mutex so only one poll runs at a time.
- Add exponential backoff + jitter after failures, especially `429`/`5xx`.
- Respect `Retry-After` when present before the next poll.

## Clean areas

- **Credential scan:** no hardcoded secrets, tokens, PATs, or private keys found in `src/`.
- **Manifest permissions:** `src/manifest.json:6-8` is reasonably minimized for current behavior: `storage`, `notifications`, `alarms`, `tabs`, plus host access only to `https://dev.azure.com/*`.

## Bottom line

No ship-blocking 🔴 issue found in the current tree, but the popup HTML sinks, approver-data logging, and polling/throttling posture should be addressed before calling the extension production-ready.

### 2026-08-28: Pre-mortem on “DevopsMonitor is ready for production use”
**By:** Fact Checker
**What:** Advisory devil’s-advocate brief arguing that the extension is not yet credibly “production ready” except under a much narrower definition.
**Why:** PLAN.md and the current source tree show a functional MVP, but they also expose silent-failure paths, ambiguous monitoring semantics, weak validation, and operational assumptions that are too load-bearing for an unqualified production-readiness claim.

## Evidence snapshot

- ❌ No automated test suite is present; `package.json` has only `build` and `dev` scripts (`package.json:5-7`), and no `*.test.*` / `*.spec.*` files exist in the repo.
- ❌ The extension is still labeled `version: "0.1.0"` and `private: true` (`package.json:3-4`, `src/manifest.json:4`), which reads as pre-release, not production-hardened.
- ❌ Approval checks depend on a preview API and explicitly fail silently (`src/api/approvals.ts:7,16-18`).
- ❌ Polling is pinned to the selected build run, not the evolving pipeline: `lastBuildId` is stored from the current page (`src/popup/popup.ts:240`) and the poller says “Never advance to a newer build automatically” (`src/background/poller.ts:18-24`).
- ⚠️ State isolation is weak: snapshots are keyed only by `pipelineId` (`src/background/state.ts:5-21`) even though configs include org + project (`src/types/ado.ts`, `src/popup/popup.ts:235-240`).
- ⚠️ Docs are already drifting: README still lists “Monitoring multiple pipelines simultaneously” as a future idea (`README.md:27-31`) while PLAN says Phase 1 already has multi-pipeline support (`PLAN.md:169`).

## 1. Steelman of the opposition

The strongest case against “production ready” is that this looks like a solid personal MVP, not an operationally trustworthy product.

- **It has no regression net.** There are no automated tests, no integration checks, and no CI proving the extension still works when code changes or Azure DevOps behavior shifts.
- **It has silent failure modes in the exact feature users care about.** Approval detection uses a preview endpoint and returns `[]` on failure by design, meaning the user can miss the most important event without being clearly told the system degraded.
- **Its core mental model is risky/ambiguous.** The UI/README sound like “monitor this pipeline,” but the code actually monitors a pinned build run unless legacy fallback triggers. That is a major expectation trap for production use.
- **It is not operationally observable.** Errors mostly go to `console.*`; there is no telemetry, no persistent error surface, no stale-health warning, and no explicit “monitor is degraded” state.
- **It is only lightly scoped for single-user local use.** Secrets and state live in `chrome.storage.local`; there is no sync, fleet management, rotation handling, or admin controls.
- **Data boundaries are not hardened.** Snapshots keyed only by `pipelineId` and dismissed builds stored as naked build IDs are acceptable for a narrow self-use scenario, but weak for broader multi-project/org usage.
- **Documentation drift has already started.** If README and PLAN are already inconsistent before ship, support and trust will degrade fast after ship.

Bottom line: this is “works on my machine” closer than “production-grade notifier.”

## 2. Load-bearing assumptions

If any of these are false, the readiness claim weakens substantially:

1. **Users understand this as build-run monitoring, not continuous pipeline monitoring.**
   - If false, missed notifications on later runs are likely.
2. **PATs stay valid and sufficiently scoped.**
   - There is no explicit expiry/rotation UX or degraded-mode handling.
3. **Azure DevOps approvals API remains usable enough despite preview status.**
   - If contract/permissions differ, approval alerts silently disappear.
4. **Single-user, single-browser, mostly single-org usage is the real target.**
   - Local-only storage and weak key scoping become much riskier otherwise.
5. **Polling every 30 seconds per monitored config is operationally acceptable.**
   - Rate limits, noisy polling, or many monitored items could make this brittle.
6. **Console logging is sufficient for diagnosis.**
   - If users do not inspect extension logs, failures remain invisible.
7. **The user always has another source of truth for critical deploys.**
   - If this becomes the primary alerting path, missed events become business-impacting.

## 3. Pre-mortem: 30 days after shipping

**Scenario:** Max relies on DevopsMonitor to catch production approval gates for an important YAML pipeline.

- On day 1, Max opens build **#8123**, selects the Prod stage, and clicks **Start Monitoring**.
- The extension stores `lastBuildId = 8123` and keeps polling that run specifically.
- Two weeks later, a new production deployment runs as build **#8291**. Max assumes the pipeline is still being watched.
- No notification arrives, because the poller is intentionally pinned to the old build and does not advance to newer runs automatically.
- The release waits at a manual approval gate. The team notices only when the deployment misses an expected window or someone manually checks Azure DevOps.
- Max opens the extension and sees no obvious “you are watching an old run” failure banner; logs, if any, are buried in extension console output.

**Why it happens:** the product promise is interpreted as pipeline monitoring, but implementation semantics are per-build-run monitoring plus silent degradation around approvals.

**Who notices:** release engineer / approver / downstream team waiting on deployment.

**Severity:** medium to high. Not a data breach, but a trust breach in a production workflow tool. Once a notifier misses one critical prod event, users stop relying on it.

## 4. Alternative, more conservative definition of “production ready”

A safer claim would be:

> **Ready for personal beta / guarded self-hosted use** for one user, one browser profile, one Azure DevOps org, and non-SLA-critical monitoring where Azure DevOps remains the primary source of truth.

Practical path:

1. **Soft-launch to self only.**
   - Explicitly document “per-build monitoring,” local-only storage, and no guarantee of approval detection.
2. **Add observability before broadening claims.**
   - Show last successful poll, last error, token/auth status, and degraded approval-detection status in the UI.
3. **Add a minimum quality bar.**
   - A few automated tests for URL parsing, state transitions, and approval detection behavior.
4. **Resolve semantics.**
   - Either market it as “monitor this build run” or implement true pipeline-following behavior.
5. **Only then call it production-ready for personal use.**

## 5. Risk acceptance checklist

Before shipping, the user should consciously accept or mitigate:

- **Missed approval notifications** due to preview API behavior or permission gaps.
- **Missed events on later runs** if users assume monitoring follows the pipeline automatically.
- **No automated regression protection** for future edits.
- **No centralized telemetry / audit trail** when notifications fail.
- **PAT handling risk** from local browser storage and manual rotation.
- **Single-device / single-profile state** with no sync or shared operational visibility.
- **Possible state collisions** across projects/orgs because some stored keys are under-scoped.
- **Doc/support confusion** from README/PLAN drift and evolving feature semantics.
- **Polling scalability risk** if the number of monitored configs grows.

## Recommendation

Do **not** market this as broadly “ready for production use.”  
Do market it, if desired, as a **personal beta / controlled pilot** until:

- monitoring semantics are clarified,
- silent failures are surfaced,
- approval detection is hardened,
- and a minimal automated test suite exists.

### 2026-08-28T10:12:01.773+02:00 — Approve PLAN.md revision

**Reviewer:** Basher  
**Artifact:** `PLAN.md`  
**Verdict:** **APPROVE**

### What I verified

1. **`File Structure (as built)` now matches the repo**
   - `src/api/` contains:
     - `ado-client.ts`
     - `approvals.ts`
     - `pipelines.ts`
   - `src/utils/` contains:
     - `storage.ts`
     - `url-builder.ts`
   - The previous nonexistent references (`builds.ts`, `timeline.ts`, `url-parser.ts`) are gone from `PLAN.md`.

2. **Storage keys now match `src/utils/storage.ts`**
   - Verified keys in code:
     - `ado_org_url`
     - `ado_pat`
     - `pipeline_configs`
     - `build_snapshots`
     - `dismissed_builds`
     - `last_polled_at`
   - `PLAN.md` now documents those exact keys.

3. **Classic Release documentation removal is still intact**
   - No remaining `vsrm` / `Classic Release` references found in `PLAN.md`.
   - The document now reads as a current-state YAML/Build pipeline plan without stale abandoned-feature narrative.

### Review conclusion

This revision fixes the factual errors that caused my earlier rejection. `PLAN.md` now matches the implemented `src/api/` and `src/utils/` structure, uses the correct storage keys, and stays clean of obsolete Classic Release pipeline documentation. Coherent enough to approve.

### 2026-08-28: Correct PLAN.md as-built file and storage facts
**By:** Reuben
**What:** Updated PLAN.md to replace nonexistent file references (`src/api/builds.ts`, `src/api/timeline.ts`, `src/utils/url-parser.ts`) with the actual implementation files (`src/api/pipelines.ts`, `src/api/approvals.ts`, `src/api/ado-client.ts`, `src/utils/storage.ts`, `src/utils/url-builder.ts`). Corrected the documented chrome.storage.local keys from `pat`/`orgUrl` to `ado_pat`/`ado_org_url` and added `last_polled_at`.
**Why:** Basher rejected the broader PLAN.md bundle because the as-built documentation still disagreed with the real source tree and persisted storage keys. This revision fixes only those factual inaccuracies and leaves Rusty's already-approved Classic Release cleanup intact.

### 2026-08-28T10:05:50+02:00: Reject Classic Release cleanup as-is
**By:** Basher
**What:** Rejected the current cleanup bundle. Removing `https://vsrm.dev.azure.com/*` from `src/manifest.json` is safe and `npm run build` still passes, but `PLAN.md` is still not fully accurate as an as-built description.
**Why:** Independent review found no `vsrm` references under `src/`, and the built code only targets `https://dev.azure.com/*`, so the manifest permission reduction is correct. However, `PLAN.md` still claims files that do not exist (`src/api/builds.ts`, `src/api/timeline.ts`, `src/utils/url-parser.ts`) even though the repo actually uses `src/api/pipelines.ts` and `src/utils/url-builder.ts`. It also documents storage keys as `pat`/`orgUrl`, while the code persists `ado_pat`/`ado_org_url`. Reuben should revise `PLAN.md` to match the current implementation before this cleanup is approved.

### 2026-08-28T09:53:33+02:00: Retire Ralph (Work Monitor)
**By:** HellHunterMax (via Copilot)
**What:** Removed Ralph (Work Monitor) from the active roster — not actively used for backlog monitoring. Folder moved to `.squad/agents/_alumni/ralph/`, removed from `team.md` roster and `routing.md`, registry status set to `retired` (name reserved, not deleted).
**Why:** User requested removal of unused members; Ralph's backlog-monitoring role is not in active use on this project.

### 2026-08-28T09:43:06+02:00: Formal role split — PM / Architect / Developer / Reviewer / Tester
**By:** HellHunterMax (via Copilot)
**What:** Restructured squad collaboration into 5 explicit roles per user directive:
- **Product Manager (Reuben, new):** defines requirements, writes user stories, creates acceptance criteria, spec-kit expert.
- **Architect (Rusty, re-scoped from Lead):** designs the solution, identifies risks, guards simplicity, challenges unnecessary complexity, adds decisions to the spec-kit. No longer owns code review.
- **Developer (Linus — Extension, Saul — UI, unchanged agents):** implements approved designs only, does not make product or architecture decisions.
- **Reviewer (Basher, new):** reviews architecture, code quality, security and permissions.
- **Tester (Livingston, unchanged agent):** defines test scenarios, looks for edge cases, validates acceptance criteria.

Flow: Reuben (spec) → Rusty (design) → user review → Basher (design/code review) → Linus/Saul (implementation) → Basher (code review) → Livingston (test + acceptance criteria validation).

Updated `.squad/team.md`, `.squad/routing.md`, casting registry/history, and charters for Rusty/Linus/Saul/Livingston; created charters + history for Reuben and Basher.
**Why:** User directive to formalize SDLC-style collaboration roles, complementing the earlier move to Spec Driven Development.

### 2026-08-28T09:35:05+02:00: Adopt Spec Driven Development
**By:** HellHunterMax (via Copilot)
**What:** Before implementing any feature, the team must:
1. Understand the requirement.
2. Create a specification containing: problem statement, user story, acceptance criteria, risks and assumptions.
3. Create a technical design.
4. Break the work into implementation tasks.
5. Wait until the spec and design have been reviewed by the user.
6. Only then generate code.

Agents must never start implementing directly from a high-level idea — a reviewed spec + design is a hard prerequisite for any code generation.
**Why:** Project is moving away from "vibe coding" to a disciplined spec-first workflow, per explicit user directive.

### 2026-08-28: Remove dead Classic Release host permission
**By:** Linus
**What:** Removed the unused `https://vsrm.dev.azure.com/*` host permission from `src/manifest.json` after verifying the `src/` tree has no remaining Classic Release / `vsrm` code paths.
**Why:** The extension only targets `dev.azure.com` YAML/Build APIs, so keeping the old Classic Release host permission would be misleading and unnecessarily broad.

### 2026-08-28: Remove Classic Release Pipeline Documentation
**By:** Rusty (Architect)
**Status:** Implemented

#### Context

The extension was originally planned to support Classic Release pipelines (`vsrm.dev.azure.com`) but that feature was never built—it was dropped early in favor of YAML/Build pipelines only. Historical references to this abandoned feature existed only in documentation (PLAN.md), creating confusion and maintenance noise.

The user explicitly requested removal of all documentation about this abandoned feature, as it was never actually implemented and only adds planning clutter.

#### What Was Removed

From **PLAN.md**:

1. **"Current State (as built)" paragraph** — Removed the narrative about the original plan targeting Classic Release pipelines and the pivot to YAML/Build. Simplified to state factually what was built.

2. **Blockquote** — Removed the line `> Classic Release pipelines (\`vsrm.dev.azure.com\`) were dropped. YAML/Build pipelines only.`

3. **Phase 1 roadmap bullet** — Changed from `YAML/Build pipeline monitoring (Classic Releases dropped)` to simply `YAML/Build pipeline monitoring`.

**README.md** — Already clean; no references to removed features found.

#### Why This Matters

Keeping abandoned-feature documentation introduces:
- **Cognitive load** for new contributors reading the spec
- **Maintenance risk** if someone misreads historical notes as current scope
- **Noise** that obscures the actual, built feature set

PLAN.md now cleanly describes what exists: YAML/Build pipeline monitoring via context-aware popup. Done.

#### No Code Changes

This is documentation only. Linus is handling code/manifest cleanup separately.

### 2026-08-26T11:00:22+02:00: Project plan updated to reflect current state
**By:** Rusty
**What:** PLAN.md rewritten to match implemented architecture (YAML pipelines, context-aware popup, stage pills, dismissed builds). Phases 3–4 updated with two new post-MVP ideas from Max: auto-show popup setting and in-page content script monitor button.
**Why:** Plan was out of date after several implementation pivots. Two new Phase 3 ideas captured before they're forgotten.

### 2026-08-26T10:11:48+02:00: YAML pipeline implementation complete
**By:** Linus
**What:** Replaced Classic Release API with YAML Build pipeline API. Implemented project caching (1-hour TTL), per-pipeline stage preference UI (checkboxes per stage for completion/approval notifications), multi-pipeline monitoring, poller with state change detection, and click-to-navigate notifications.
**Why:** User requirement — Classic Releases not used; pipeline stages with selective notification is the core feature.

### 2026-08-26T10:11:48+02:00: Switch to YAML multi-stage pipelines
**By:** Rusty
**What:** Replaced Classic Release pipeline API with YAML Build pipeline API. Monitoring now targets build pipeline stages via the timeline API. Per-pipeline, per-stage notification preferences stored in chrome.storage.local. Projects cached with 1-hour TTL.
**Why:** Max's team uses YAML pipelines, not Classic Releases. Stage-level granularity is required because not all stages are interesting — test/build stages are noise, acc/prod stages are signal. Per-stage approval notifications map directly to ADO environment approval policies.

### 2026-08-26T09:22:37+02:00: Extension skeleton scaffolded
**By:** Linus
**What:** Created full MV3 extension skeleton — manifest, service worker with chrome.alarms, popup picker shell, options page, typed ADO API stubs, storage utils, and webpack build config.
**Why:** Establishes the compilable foundation all subsequent MVP tasks build on.

### 2026-08-26T09:05:58+02:00: MVP scope defined

**By:** Rusty  
**What:** MVP targets Classic Release pipelines only with PAT auth, single deployment monitoring, and four notification events (approval pending, succeeded, failed, manual validation). The popup includes an in-extension pipeline picker (org → project → definition) so the user never pastes a URL — the extension fetches pipeline lists via the ADO API and constructs all deep-link URLs internally. Content script injection deferred to Phase 2.  
**Why:** Classic Release API is well-documented and directly maps to the approval/deployment events in the README. The in-popup picker is essential UX — requiring users to paste ADO URLs manually is friction that kills adoption. Keeping MVP to one pipeline type and one deployment at a time minimises scope and gets Max something testable fast.

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction

### 2026-08-28: Production blockers re-validation after pinned-build failure fix
**By:** Livingston
**What:** Re-validated the current implementation against the approved production-blocker scope by reading `src/background/poller.ts`, `src/background/poller.test.ts`, the popup/storage/state identity paths, and by running `npm test`. Verdict: the pinned-build failure drift is fixed, the exact monitoring identity is now used consistently across popup/storage/background behavior, and all three approved blockers are resolved for this release scope.
**Why:** The last open blocker was the poller substituting a different "latest build" when the pinned build fetch failed. That path now skips the cycle instead of changing identity, so it no longer writes or notifies against the wrong run. Combined with the existing composite-key popup/storage/state changes, wrong-org PAT gating, popup XSS-safe rendering, and a green Jest suite, I no longer see an in-scope blocker preventing a production-ready-for-this-scope call.

#### Evidence checked
- `src/background/poller.ts`: pinned-build mode now fetches the configured `buildId`, logs a warning on fetch failure, and `continue`s the loop instead of falling back to another build.
- `src/background/poller.test.ts`: the pinned-build failure test now asserts the existing snapshot is preserved, only one fetch occurs, and no notification is sent.
- `src/types/ado.ts`, `src/utils/storage.ts`, `src/background/state.ts`, `src/popup/popup.ts`: the monitoring identity is the same `{ org, project, pipelineId, buildId }` tuple throughout popup matching, dismissed-state handling, snapshot persistence, and poller reads/writes.
- `src/popup/popup.test.ts`: exact-match State A / exact-dismiss State B / near-miss State C are covered; wrong-org pages are blocked before client construction or fetch; hostile strings render literally with no injected executable DOM.
- `package.json`, `jest.config.cjs`, `test/setup/jest.setup.ts`, and the five `*.test.ts` files confirm a real automated Jest baseline for popup, poller, state, URL parsing/building, and storage.

#### Acceptance verdict
- **Blocker 1:** Met.
- **Blocker 2:** Met.
- **Blocker 3:** Met, including the previously failing consistency criterion.

#### Test run
- Command: `npm test`
- Result: **PASS**
- Suites: **5 passed / 5 total**
- Tests: **27 passed / 27 total**
