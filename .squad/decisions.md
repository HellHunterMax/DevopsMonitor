# Squad Decisions

## Active Decisions

### 2026-09-15: Stale data cleanup implementation simplified after over-engineering audit
**By:** Squad (Coordinator), directed by Max Buining, following independent audits from Basher and Rusty
**What:** The user requested a review of the merged stale-data-cleanup diff (~1,600 src lines / 15 files) and both Basher (code review) and Rusty (architecture) independently concluded it was over-engineered relative to the actual ask ("delete records older than 12 hours"). Approved simplification: (1) revert the single-writer service-worker message-passing refactor — popup/options go back to writing `chrome.storage.local` directly, keeping only the prune alarm/startup wiring in the service worker; (2) trim `poller.ts` back to only the lifecycle-metadata capture needed for pruning, reverting unrelated helper reshaping/formatting churn; (3) extract and separately document the unrelated `AdoApproval.pipeline.owner.id` string-widening bugfix as its own dated decision with its own test case, independent of the pruning feature; (4) drop the legacy `dismissed_builds` migration/backfill logic — legacy records without `dismissedAt` are dropped/expired rather than backfilled, consistent with the existing 2026-09-04 decision to not carry pre-1.0 storage migration compatibility; (5) remove dead code (`cloneState()`) if it remains unused.
**Why:** The core prune rule, canonical keying, and lifecycle metadata were justified by the spec, but the single-writer refactor solved a low-stakes race condition (single-user local extension) at a cost disproportionate to the feature, and the migration/backfill logic directly contradicted the team's own recent pre-1.0 no-migration-compatibility stance. Per user direction, any future bugfix found opportunistically during feature work must be documented as its own fix with its own test case rather than silently bundled into an unrelated feature's diff. All written code changes must go through a review pass (Basher and/or Rusty as appropriate) before being considered done — this is now standing practice, not a one-off.

### 2026-09-15: Stale data pruning product definition
**By:** Reuben
**What:** Defined the stale-data cleanup feature around the existing product truth that DevopsMonitor monitors one specific Azure DevOps build run, not a forever-followed pipeline. Product direction: completed monitored build runs should age out after a 12-hour retention window, and their associated snapshots should be removed with them; snapshots should not be pruned earlier than a retained monitored item because that would reset notification deduping state.
**Why:** The current storage model (`pipeline_configs` + `build_snapshots`) is build-run scoped and can accumulate outdated entries indefinitely. Framing cleanup around completed-run retention preserves active monitoring behavior while removing stale UI/storage noise and preventing orphaned snapshot cache from lingering forever.

### 2026-09-15: Finalized stale monitored-build data pruning design
**By:** Rusty
**What:** Finalized a 12-hour retention design anchored to **build completion** for monitored builds and snapshots, with a state-aware prune exemption for still-active / approval-pending builds, plus unchanged 12-hour `dismissedAt` expiry for dismissed builds. Cleanup remains one unified automatic sweep over `pipeline_configs`, `build_snapshots`, and `dismissed_builds`, scheduled via MV3-safe `chrome.alarms` plus install/startup catch-up.
**Why:** The product decision was reverted after Fact Checker identified a real failure mode: a start-anchored hard cap could silently stop monitoring long-running approval-gated builds before their approval-needed event. Completion-anchored retention preserves the core notification promise while still guaranteeing bounded storage growth after a build reaches terminal state.

#### Current architecture facts this design is based on

- `src/manifest.json` declares MV3 background worker `background/service-worker.js` and already includes `storage` + `alarms`. It does **not** request `unlimitedStorage`, so `chrome.storage.local` remains on the default quota.
- `src/background/service-worker.ts` already uses `chrome.alarms` for `devops-poll` every 30 seconds and runs work from `onInstalled`, `onStartup`, alarm callbacks, and `FORCE_POLL`.
- `src/types/ado.ts` models monitored state with exact-key records:
  - `MonitoringKey = { org, project, pipelineId, buildId }`
  - `PipelineConfig extends MonitoringKey`
  - `BuildSnapshot extends MonitoringKey`
- `src/utils/storage.ts` persists `pipeline_configs`, `build_snapshots`, `dismissed_builds`, and `last_polled_at` in `chrome.storage.local`.
- `build_snapshots` are subordinate dedupe state for the matching monitored build. If their config disappears, the snapshot is dead state.

#### Final retention rule

- **Monitored builds + snapshots:** eligible for pruning only after the build is terminal/completed, and only once **12 hours have passed since `finishTime`**.
- **Active-build exemption:** if the build is still in progress or currently approval-pending, it is **not prune-eligible at all**, regardless of elapsed wall-clock time.
- **Fallback anchor:** if a build is known terminal/completed but Azure DevOps does not provide `finishTime`, use the **last successful poll timestamp that observed the build in terminal state**.
- **Dismissed builds:** unchanged from the prior design — expire 12 hours after `dismissedAt`.
- **Automatic only:** no manual “Clean now” action.

#### Exact schema changes

##### 1. `PipelineConfig`

Do **not** add `monitoringStartedAt`.

Recommended shape change: **none** for retention.

Rationale:
- prune eligibility for a monitored-build record should be derived from the latest known build lifecycle state of its matching snapshot
- adding a monitoring-start timestamp would reintroduce the rejected start-anchored rule

##### 2. `dismissed_builds`

Current shape is effectively `MonitoringKey[]`. That is insufficient because there is no timestamp.

Change to a typed record, e.g.:

- `DismissedBuild extends MonitoringKey { dismissedAt: number }`

Semantics:
- set `dismissedAt = Date.now()` when the user chooses “Don’t monitor this build”
- clear the matching dismissed record if the user later starts monitoring that same build

Why not reuse `monitoringStartedAt` here:
- the user never started monitoring this build
- `dismissedAt` is the correct domain name for the retention anchor on this record type

##### 3. `BuildSnapshot`

`finishTime` is available on `AdoBuild` responses, but it is **not currently persisted** in `build_snapshots` or `pipeline_configs`. To support prune decisions without doing fresh ADO fetches during every sweep, extend `BuildSnapshot` with build-lifecycle metadata captured by the poller.

Add:

- `lastSuccessfulPollAt: number`
- `buildStatus: string`
- `buildFinishedAt?: number`

Semantics:
- `lastSuccessfulPollAt` = `Date.now()` whenever `runPoll()` successfully writes the snapshot
- `buildStatus` = latest `AdoBuild.status` observed for that monitored build
- `buildFinishedAt` = parsed epoch milliseconds from `AdoBuild.finishTime` when present and valid

Prune anchor derivation:
- if `buildStatus !== 'completed'`, the build is active and not prune-eligible
- if any watched stage snapshot has `approvalPending === true`, the build is also not prune-eligible
- if `buildStatus === 'completed'`, use `buildFinishedAt`
- if `buildStatus === 'completed'` but `buildFinishedAt` is absent, use `lastSuccessfulPollAt` as the fallback terminal anchor

Why snapshot is the right place for this metadata:
- the poller already fetches build status and `finishTime` every cycle
- snapshots are already the per-build background state record that changes over time
- `PipelineConfig` remains user-selection data rather than poll-derived lifecycle state

#### Migration / backfill policy for existing installs

Existing persisted records do not have `buildStatus`, `buildFinishedAt`, `lastSuccessfulPollAt`, or `dismissedAt`.

Recommendation:

- keep old monitored builds/configs **until a successful poll rewrites their snapshot with the new metadata**
- treat missing snapshot lifecycle metadata as **not yet eligible for pruning**, not expired
- keep the prior recommendation for dismissed builds: missing/invalid `dismissedAt` means expired on first prune pass

Why this is the right tradeoff:
- inventing a terminal completion time for an existing monitored build would risk deleting an active approval-gated build incorrectly
- unlike the start-anchored design, completion-based expiry requires a trustworthy terminal-state observation before deletion
- the poller already refreshes monitored items frequently, so valid retained items should naturally acquire the new snapshot metadata soon after upgrade

Practical result:
- pre-feature monitored items are temporarily retained until their snapshot is rewritten with lifecycle metadata
- once a rewritten snapshot shows the build terminal/completed, the normal 12-hour completion-based rule applies
- pre-feature `dismissed_builds` entries without `dismissedAt` are pruned

#### Unified prune algorithm

Implement one background helper, preferably pure at the core:

- `pruneMonitoringState(now, configs, snapshots, dismissed)`

##### Inputs

- `configs = await getPipelineConfigs()`
- `snapshots = await getBuildSnapshots()`
- `dismissed = await getDismissedBuilds()`
- `cutoff = now - 12 * 60 * 60 * 1000`

##### Sweep rules

1. Index snapshots by `MonitoringKey`.

2. For each monitored-build config:
   - if there is **no matching snapshot**, keep the config for now and do not prune it in this pass
   - if the matching snapshot has `buildStatus !== 'completed'`, keep it
   - if the matching snapshot has any `stage.approvalPending === true`, keep it
   - otherwise derive `terminalAnchor = buildFinishedAt ?? lastSuccessfulPollAt`
   - if `terminalAnchor` is not a finite number, keep it
   - prune the config only when `terminalAnchor <= cutoff`

3. Build a `Set` of surviving config keys using `monitoringKeyToString()`.

4. **Keep snapshots** only when:
   - the exact matching config key survived, or
   - the matching config is still temporarily retained because prune eligibility could not yet be determined

   Practical effect:
   - if the config expired, the snapshot goes too
   - if the config was removed manually earlier, the snapshot is pruned as an orphan

5. **Keep dismissed-build records** only when:
   - `dismissedAt` is a finite number, and
   - `dismissedAt > cutoff`

6. If any collection changed, persist all changed keys in **one** `chrome.storage.local.set(...)` write.

##### Important pruning rule

For monitored builds/snapshots, the prune helper **must** inspect the stored lifecycle metadata:
- `buildStatus`
- `buildFinishedAt`
- `lastSuccessfulPollAt`
- watched-stage `approvalPending`

It must **not** use monitoring-start time.

#### When pruning runs

Use `chrome.alarms`, matching the existing MV3 pattern.

##### Dedicated prune alarm

Add a second alarm, e.g. `devops-prune`, with a coarse cadence such as **60 minutes**.

Why hourly:
- much cheaper than piggybacking on the 30-second poll alarm
- still bounds stale data tightly relative to a 12-hour TTL
- fully compatible with MV3 service-worker suspension

##### Opportunistic automatic runs

Run the same prune helper:

- on `runtime.onInstalled`
- on `runtime.onStartup`
- before the first poll triggered from startup/install code
- before writing a new monitored-build config
- before writing a new dismissed-build record

This catches:
- missed alarms while the browser was closed
- stale records surviving extension reload/update
- orphan snapshots left behind by config changes

##### Explicit non-requirement

Do **not** add a manual cleanup button. Automatic alarm/startup/on-write cleanup is enough.

#### Write-path touch points for implementation

##### Starting monitoring

Wherever the popup currently writes a new `PipelineConfig`, populate:

- no new retention timestamp on the config itself

Behavior:
- keep `PipelineConfig` focused on user-selected monitoring identity + stages
- let the first successful poll establish the lifecycle metadata on the matching snapshot

##### Dismissing a build

Wherever the popup currently writes to `dismissed_builds`, write:

- `{ org, project, pipelineId, buildId, dismissedAt: Date.now() }`

##### Snapshot writes

Extend snapshot writes to persist:

- `lastSuccessfulPollAt = Date.now()`
- `buildStatus = build.status`
- `buildFinishedAt = parse(build.finishTime)` when valid

`saveSnapshot()` remains keyed by `MonitoringKey`, and prune eligibility for both the snapshot and its config comes from this stored snapshot metadata.

#### UI naming note

The user-facing label should change from **“Monitored pipelines”** to **“Monitored builds.”**

Recommendation:
- keep this as a **display-string-only** change
- do **not** rename internal storage keys (`pipeline_configs`), `PipelineConfig`, or `pipelineId` in this cleanup feature

Why:
- the internal model already works; the ambiguity is user-facing terminology, not the TypeScript/storage identifier set
- renaming internal identifiers would add churn and review surface without improving pruning correctness

#### Risks and review points for Basher

##### 1. Concurrent writes / overlap

Current code does blind read-modify-write array mutations from multiple contexts:
- service worker poll
- popup monitoring changes
- options-page deletes
- manual `FORCE_POLL`

Recommendation:
- serialize background prune + poll behind one module-scope promise/lock
- batch prune writes to one storage `set`
- if feasible later, centralize more mutations through the service worker

##### 2. Partial-write inconsistency

If configs, snapshots, and dismissed records are written separately, state can split.

Recommendation:
- persist all sweep outputs together in one write

##### 3. Upgrade pruning surprise

Because old snapshots lack lifecycle metadata, pre-upgrade monitored items may remain longer than 12 hours until a successful poll rewrites them.

Recommendation:
- accept this as the safer migration policy
- do not guess completion time for old records
- cover the temporary-retention behavior in tests and internal review notes

##### 4. Testability

Livingston should be able to validate this with fake timers.

Recommended coverage:
- exactly-at-12h boundary
- just-under / just-over boundary
- terminal build with valid `finishTime`
- terminal build missing `finishTime` uses `lastSuccessfulPollAt`
- non-terminal build never pruned
- approval-pending snapshot never pruned
- missing lifecycle metadata => retained until refreshed
- surviving config keeps snapshot
- expired or removed config drops snapshot
- dismissed record expiry
- startup/install path invokes prune
- prune + poll overlap through shared serialization

#### Implementation recommendation

1. Leave `PipelineConfig` retention-timestamp-free; drop the earlier `monitoringStartedAt` idea.
2. Extend `BuildSnapshot` with `lastSuccessfulPollAt`, `buildStatus`, and optional `buildFinishedAt`.
3. Replace `dismissed_builds: MonitoringKey[]` with timestamped dismissed-build records.
4. Add one shared prune helper that sweeps configs, snapshots, and dismissed records together.
5. Register an hourly `devops-prune` alarm in the service worker.
6. Run prune automatically on install, startup, and before new monitoring/dismissal writes.

### 2026-09-15: Stale-data TTL review
**By:** Fact Checker
**What:** Verified that the repo already had precedent for a **12-hour** retention window, but that precedent was **not** originally "12 hours from monitoring start with no exemptions." The earlier written product direction before the user's confirmation was: prune **completed** monitored builds after 12 hours, keep still-active / approval-pending builds, and anchor monitored-build staleness to `finishTime` when available. The current top-level spec has now been updated to match the user's override. Advisory verdict on that override: **❌ likely to cause real user-facing pain** unless the team reconsiders the anchor/exemption choice.
**Why:** The product's own docs and spec frame the core value as "notify me when a monitored stage completes or needs approval." A hard 12-hour cutoff from **monitoring start** can silently stop monitoring exactly the long-lived builds most likely to need approval notifications, especially overnight/weekend approval gates.

#### Verification report

##### What the repo already said before / around this confirmation
- ✅ `.squad/decisions/inbox/reuben-stale-data-pruning-spec.md` says "completed monitored build runs should age out after a 12-hour retention window" and ties the rationale to preserving active monitoring behavior.
- ✅ `.squad/decisions/inbox/rusty-stale-data-pruning-design.md` treats the exact expiry anchor as still a **product decision** and explicitly flags long-running-build early deletion as a product-risk question.
- ✅ `.squad/decisions.md` (2026-09-15 entry "Stale data cleanup — product decisions confirmed by user") records that the user **overrode** Reuben's earlier recommendation and chose the new rule: **12h from monitoring start**, hard cap, no approval exemption, same rule for `dismissed_builds`.
- ✅ `.squad/specs/stale-data-cleanup-spec.md` is now consistent with that override: it currently states monitoring-start anchoring, absolute 12-hour cutoff, no approval exemption, and inclusion of `dismissed_builds`.

##### What I did **not** find
- ✅ No prior README, docs, tests, code comments, or changelog entry establishing a competing **24h / 48h / 7d** retention window for monitored builds or snapshots.
- ✅ No earlier repo statement saying "hard cap from monitoring start even if approval is pending."

#### Consistency check against product purpose

Repo product messaging consistently says the extension exists to:
- notify when a monitored stage **completes** (`README.md`, `PLAN.md`, `docs/poller-logic.md`)
- notify when a monitored stage **needs approval** (`README.md`, `PLAN.md`, `src/background/poller.ts`)

That creates a real tension with the new rule:
- a build waiting in an approval gate is one of the most obvious cases where the user still expects monitoring to stay alive
- pruning 12 hours after **monitoring start** can remove the watch **before** the approval event the product is meant to surface

So the new rule is documented and user-confirmed, but it is still in real tension with the product framing in README / PLAN / poller docs, and it reverses Reuben's earlier completion-anchored recommendation.

#### Devil's Advocate review

##### Why 12h-from-monitoring-start is risky
1. **Approval-gated pipelines often span overnight or weekend windows.**
   Azure DevOps approvals/checks can pause execution before a stage starts and wait for approval until a configured timeout; Microsoft Learn also documents deferred approvals for later business-hours execution (`https://learn.microsoft.com/en-us/azure/devops/pipelines/process/approvals?view=azure-devops`). That makes long idle approval windows normal, not exceptional.
2. **The chosen anchor is detached from the event the product cares about.**
   Monitoring start is a UI action timestamp, not a pipeline lifecycle milestone. If the product promise is "tell me when this stage needs approval / completes," expiring by user-click time can terminate monitoring before the relevant event occurs.
3. **The hard cap disproportionately hurts the highest-value watches.**
   Short builds finish within 12 hours and are fine. Long-running, cross-time-zone, or manual-approval builds are exactly the ones where desktop notification value is highest — and they are the ones most likely to be silently dropped.

##### Concrete 30-day failure scenario
Friday 16:30: an engineer starts monitoring a production deployment build that will pause at a manual approval gate after pre-prod validation.  
Friday 22:00: the pipeline reaches the approval gate. Nobody is online.  
Saturday 04:30: DevopsMonitor prunes the monitored build because 12 hours elapsed since monitoring started.  
Monday 08:45: the approver opens Azure DevOps expecting DevopsMonitor to have warned them over the weekend / that morning, but the build is no longer monitored and no approval-needed notification is sent.  

Likely outcome within the first month after release:
- users perceive approval notifications as unreliable for real deployment workflows
- support/debugging is hard because cleanup is silent and "working as specified"
- the team gets pressure to add exceptions or bring back a longer-lived retention rule

##### Is the current rule defensible?
Only on **implementation simplicity / bounded local storage** grounds. Those are real benefits, but they are weaker than the user-facing downside because:
- the product already stores only small local records
- a longer or smarter retention rule still keeps storage bounded
- the current rule sacrifices correctness of the user experience, not just convenience

#### Alternatives

##### Better default
**Completion-anchored TTL + active/approval-pending exemption**
- Keep monitoring while the build is in progress or approval-pending.
- Start the 12-hour TTL when the build reaches a terminal state (`finishTime`).
- If `finishTime` is absent, use last successful poll time only for a build that already appears terminal.

Why this fits better:
- preserves the product promise for long-lived approval waits
- still guarantees eventual cleanup after the build is done
- matches the repo's earlier spec language

##### Simpler compromise if the team wants a hard cap
**24-48h hard cap from monitoring start**
- Still simple and storage-bounded
- Far less likely to drop overnight / next-business-day approvals
- Still imperfect for long weekends, but meaningfully safer than 12h

##### Another compromise
**12h from monitoring start, except approval-pending builds**
- Small policy carve-out
- Preserves the most user-visible/high-value scenario
- Slightly more state logic, but much less product harm

#### Recommendation

**Recommendation:** Reconsider the current anchor/exemption decision before implementation.  

If the team wants the product to remain trustworthy for its stated approval-needed use case, the best choice is:
1. keep the **12-hour number**
2. move the anchor to **build completion / terminal state**
3. preserve monitoring while the build is still **running or approval-pending**

If the user insists on a start-anchored hard cap, my advice is at least to increase it to **24-48 hours** or add an **approval-pending exemption**.

#### Final advisory verdict

**Verdict:** ❌ **Likely to cause real user-facing pain**  
**Reason:** the exact builds most likely to need long-lived monitoring (manual approvals, cross-time-zone deployments, weekend gates) are the ones this rule can silently un-monitor before the product delivers its promised approval-needed notification.

### 2026-09-15: Reject stale-data pruning design pending implementation-safety revisions
**By:** Basher
**What:** Rejected Rusty's stale-data cleanup design as **not yet implementation-ready**. The core product behavior now matches Reuben's finalized spec (completion-anchored 12h TTL, active/approval-pending exemption, finishTime fallback, orphan-snapshot pruning, automatic cleanup only, and display-only "Monitored builds" rename), but three blocking implementation-safety gaps remain: canonical keying is underspecified, pruning serialization is incomplete across extension contexts, and the legacy `dismissed_builds` migration would drop real user state on upgrade.
**Why:** The current codebase makes these gaps material. `monitoringKeyToString()` in `src/types/ado.ts` stringifies the entire object, while `PipelineConfig`, `BuildSnapshot`, and the proposed timestamped dismissed records all carry extra fields; a prune implementation that follows the design literally will not have a stable cross-type identity key. `src/utils/storage.ts`, `src/background/state.ts`, `src/popup/popup.ts`, and `src/options/options.ts` all do blind read-modify-write mutations today, so a module-scope promise lock only inside one context does not serialize popup/on-write cleanup against service-worker poll/prune work. And because shipped `dismissed_builds` records have no timestamp, "missing dismissedAt means expired immediately" would erase recent explicit dismissals for upgrading users. Revision owner should be **Linus** (not Rusty, per reviewer lockout), with the revised design requiring: (1) a canonical serializer/helper that uses only `{ org, project, pipelineId, buildId }` and is applied consistently in storage/prune/delete paths, (2) all prune executions routed through the service worker or another cross-context serialization strategy, (3) legacy snapshot lifecycle fields treated as optional until refreshed, and (4) legacy dismissed entries backfilled/grace-retained instead of pruned immediately.

### 2026-09-15: Approve Linus stale-data cleanup revision as implementation-ready
**By:** Basher
**What:** Approved `.squad/decisions/inbox/linus-stale-data-design-revision.md` as closing the four blocking implementation-safety gaps from my prior rejection while preserving Reuben’s finalized product spec in `.squad/specs/stale-data-cleanup-spec.md`. Linus should implement the background-owned monitoring-state coordinator, canonical four-field key helpers, timestamped dismissed-build migration, snapshot lifecycle metadata, prune alarm/sweep, and poll/prune serialization. Saul should implement the popup/options write-path changes so monitored-state mutations go through service-worker messages and the UI rerenders from returned/changed state, plus the display-only “Monitored builds” copy update. Livingston should test canonical key correlation across config/snapshot/dismissed shapes, legacy dismissed migration grace retention, legacy snapshot retention vs orphan pruning, terminal/fallback TTL boundaries, approval-pending/non-terminal exemptions, and cross-context race cases (popup/options mutation interleaved with poll/prune).
**Why:** 
1. **Canonical keying is now explicit and sufficient.** `src/types/ado.ts` defines the shared identity as `{ org, project, pipelineId, buildId }`, and the current risk came from `monitoringKeyToString()` serializing whole objects. Linus’s revision fixes the right seam by introducing a four-field canonical projection/serializer and requiring it everywhere configs, snapshots, and dismissed records are correlated. That matches the real current types (`PipelineConfig extends MonitoringKey`, `BuildSnapshot extends MonitoringKey`) and will remain stable once extra lifecycle/timestamp fields are added.
2. **Cross-context serialization is now workable, not theoretical.** Today the race is real: popup and options both perform direct read-modify-write storage mutations (`src/popup/popup.ts`, `src/options/options.ts`), while the service worker and poller also mutate state (`src/background/service-worker.ts`, `src/background/state.ts`, `src/background/poller.ts`). Linus’s single-writer service-worker design closes that gap at the only boundary that actually matters in MV3. This is an incremental refactor, not a greenfield rewrite, because the extension already has a functioning `chrome.runtime.sendMessage(...)` channel (`FORCE_POLL`, `TEST_NOTIFICATION`) and a service-worker `chrome.runtime.onMessage` handler to extend.
3. **Legacy dismissed-build migration now preserves user intent.** Existing `dismissed_builds` records have no timestamp in `src/utils/storage.ts`. Backfilling legacy entries to `dismissedAt = now` on first service-worker encounter, then persisting before prune evaluation, avoids upgrade-time data loss and gives a predictable fresh 12-hour grace window. That is the safest available approximation of the spec’s “12 hours from dismissal” rule when the original dismissal time is unknowable.
4. **Legacy snapshot retention is now explicit and correctly bounded.** The revision clearly scopes “retain until refreshed by a successful poll” to snapshots that still have a matching monitored config. It also explicitly prunes orphan snapshots even if they still lack the new lifecycle metadata. That preserves active monitored builds safely without letting true orphan snapshot state linger forever.

### 2026-09-15: REJECT stale-data cleanup code review
**By:** Basher
**What:** Rejected the current stale-data cleanup implementation for one blocking spec miss in the popup UI plus one directly related coverage gap. Linus should revise the popup artifact and Livingston should extend coverage; Saul is locked out from self-revising the popup piece if he authored it.
**Why:** The implementation gets the core storage/prune mechanics right, and `npm test` plus `npm run build` both pass, but it is not fully ship-ready against the approved spec/design. `src/popup/popup.html` still renders **"Monitored pipelines"** instead of the approved **"Monitored builds"** copy required by `.squad/specs/stale-data-cleanup-spec.md` and reiterated in the approved design revision. This is a user-facing product-contract miss, not a cosmetic nit, because the whole cleanup feature was explicitly framed around monitoring one pinned build run rather than an evergreen pipeline. The adjacent tests also failed to guard this requirement: `src/popup/popup.test.ts` hand-builds its own DOM fixture with the corrected string instead of exercising the real HTML template, so the suite passed while the shipped popup markup remained wrong. Fix the shipped popup copy in `src/popup/popup.html` and add a test that would fail if the real template regressed again; after that, the stale-data cleanup code can be re-reviewed quickly.

### 2026-09-15: APPROVE stale-data cleanup re-review
**By:** Basher
**What:** Approved the stale-data cleanup implementation as ready to ship after independently re-checking the shipped UI/templates, popup coverage, remaining src display copy, core prune/state logic, and the full validation commands.
**Why:** The blocking miss from the first review is fixed in the real product files: `src/popup/popup.html` now says **"Monitored builds"** and `src/options/options.html` now says **"Monitored Builds"**. `src/popup/popup.test.ts` now loads the shipped `popup.html` from disk via `readFileSync(join(__dirname, 'popup.html'))` and asserts the actual `.section-label` text, so the previous fixture-drift hole is closed. My independent `src/` sweep found no remaining runtime **"Monitored pipeline(s)"** display text; only a non-user-facing HTML comment still uses the old wording. The original implementation review still stands on spot-check: canonical composite keying is intact in `src/types/ado.ts` and its tests, mutation routing still goes through the background single-writer path in `src/background/service-worker.ts`/`src/options/options.ts`, prune behavior and dismissed-build migration remain covered in `src/background/state.ts` + `src/background/pruner.test.ts`, legacy snapshots are still retained until refreshed, hourly prune scheduling is still registered, and the 2026-09-01 approval-detection fix remains guarded by the mixed named+stage-less and parallel-stage poller tests. Independent validation passed: `npm test` and `npm run build`.

### 2026-09-15: Linus revision — implementation-safe stale-data cleanup design
**By:** Linus  
**What:** Revises Rusty’s stale-data cleanup design so it is safe against the actual MV3/storage code paths in this repo. The product behavior stays unchanged from Reuben’s finalized spec: monitored builds and snapshots expire 12 hours after terminal completion, active/approval-pending builds are exempt, `finishTime` falls back to the last successful terminal poll, orphan snapshots are prune-eligible, `dismissed_builds` expire 12 hours after dismissal, cleanup is automatic only, and the UI label change remains display-only.  
**Why:** Basher’s rejection is correct at the implementation layer. The current codebase does not have a canonical cross-type identity serializer, does not have cross-context mutation serialization, and cannot safely upgrade legacy `dismissed_builds` records without a data-preserving migration.

#### Current-code constraints this revision is addressing

- `src/types/ado.ts` currently defines `MonitoringKey`, `PipelineConfig`, and `BuildSnapshot`, but `monitoringKeyToString()` does `JSON.stringify(key)` on the whole object.
  - That is safe only when the object shape is identical.
  - It is **not** safe once `BuildSnapshot` gains lifecycle fields or `dismissed_builds` becomes timestamped.
- `src/utils/storage.ts`, `src/background/state.ts`, `src/popup/popup.ts`, and `src/options/options.ts` all currently do direct `chrome.storage.local` read-modify-write mutations.
  - That means popup/options mutations can race service-worker prune/poll writes.
  - A module-scope promise lock in one file/context would not protect the others.
- Existing shipped `dismissed_builds` records are plain `MonitoringKey[]` with no dismissal timestamp.
- Existing shipped `build_snapshots` records have no lifecycle metadata yet.

#### Revised design

##### 1) Canonical monitoring identity: one helper, four fields only

The code needs a canonical identity helper that intentionally ignores non-key fields.

##### `src/types/ado.ts`

Keep `MonitoringKey` as the identity contract, then add one helper that always projects any key-like object down to the same four fields:

```ts
export type MonitoringKeyLike = Pick<MonitoringKey, 'org' | 'project' | 'pipelineId' | 'buildId'>;

export function toMonitoringKey(value: MonitoringKeyLike): MonitoringKey {
  return {
    org: value.org,
    project: value.project,
    pipelineId: value.pipelineId,
    buildId: value.buildId,
  };
}

export function monitoringKeyToString(value: MonitoringKeyLike): string {
  const key = toMonitoringKey(value);
  return JSON.stringify({
    org: key.org,
    project: key.project,
    pipelineId: key.pipelineId,
    buildId: key.buildId,
  });
}
```

Notes:

- Keeping the serialized form as JSON is fine **once the helper first strips the object to the canonical four-field tuple in a fixed order**.
- `monitoringKeyEquals()` should either stay field-by-field or compare `monitoringKeyToString(a) === monitoringKeyToString(b)`; either is correct once the serializer is canonical.

##### Where this canonical helper must be used

This must become the only identity serializer used for:

- `dedupeByKey()` in `src/utils/storage.ts`
- snapshot/config/dismissed correlation inside the future prune helper
- popup/options delete button `data-key` values
- matching a `PipelineConfig` to its `BuildSnapshot`
- matching either of those to a timestamped dismissed-build record
- any `Map` / `Set` / filter logic used in prune or delete paths

##### Important implementation rule

No caller may ever rely on `JSON.stringify(fullObject)` for identity again.  
The only valid identity is `{ org, project, pipelineId, buildId }`.

---

##### 2) Cross-context serialization: service worker becomes the single writer

Rusty’s “module-scope promise lock” idea is directionally right but insufficient if it exists only in one JS context. MV3 popup pages, options pages, and the service worker are separate execution contexts. `chrome.storage.local` does not give us transactions or cross-context compare-and-swap.

The safe design is:

- **the service worker owns all mutations for monitoring state**
- popup/options pages stop writing `pipeline_configs`, `build_snapshots`, and `dismissed_builds` directly
- all such mutations are routed through `chrome.runtime.sendMessage(...)`
- the service worker serializes those mutations through one in-worker queue

##### Single-writer boundary

The single-writer boundary should cover these keys:

- `pipeline_configs`
- `build_snapshots`
- `dismissed_builds`
- `last_polled_at`

Credentials can stay outside this design because they are not part of stale-data pruning correctness.

##### `src/background/state.ts`

Promote this module from “snapshot helpers” to the background-owned state coordinator.

Recommended responsibilities:

```ts
export interface DismissedBuild extends MonitoringKey {
  dismissedAt: number;
}

export interface MonitoringStateData {
  pipelineConfigs: PipelineConfig[];
  buildSnapshots: BuildSnapshot[];
  dismissedBuilds: DismissedBuild[];
  lastPolledAt: number | null;
}

export async function readMonitoringState(): Promise<MonitoringStateData>;
export async function writeMonitoringState(next: MonitoringStateData): Promise<void>;
export async function mutateMonitoringState<T>(
  reason: string,
  mutator: (state: MonitoringStateData) => Promise<T> | T
): Promise<T>;
```

Behavior:

- `mutateMonitoringState()` is backed by one module-scope promise queue **inside the service worker only**
- each queued mutation:
  1. reads the latest monitoring collections
  2. applies one mutation or prune pass in memory
  3. writes the affected collections back in one `chrome.storage.local.set(...)`
  4. returns the post-commit state/result to the caller

Because every mutation request from popup/options is funneled into the service worker, this queue is now truly cross-context for the monitored-state keys.

##### `src/background/service-worker.ts`

Add explicit message handlers for monitored-state mutations, for example:

- `GET_MONITORING_STATE_OVERVIEW`
- `UPSERT_MONITORED_BUILD`
- `REMOVE_MONITORED_BUILD`
- `DISMISS_BUILD`
- `UNDISMISS_BUILD`
- `DELETE_SNAPSHOT`
- `CLEAR_MONITORED_BUILDS`
- `CLEAR_BUILD_SNAPSHOTS`
- `CLEAR_DISMISSED_BUILDS`
- `RUN_STALE_DATA_PRUNE`
- existing `FORCE_POLL`

Every state-changing message must call `mutateMonitoringState(...)` and must **not** write to `chrome.storage.local` directly from the popup/options page.

##### `src/popup/popup.ts`

Replace direct write paths:

- stop importing `setPipelineConfigs`, `dismissBuild`, `undismissBuild`, and `clearSnapshot` for writes
- stop performing local read-modify-write mutations in the popup context
- send runtime messages to the service worker instead

Specific current hot spots that must change:

- “Stop Monitoring” button
- “Start Monitoring” save path
- “Don’t monitor this build”
- “Monitor this build” after dismissal

Also remove the current direct `clearSnapshot(previousConfig ?? monitoringKey)` call from the popup.  
That snapshot reset should happen inside the same background mutation that upserts monitoring for that key, so config update + snapshot clear are one serialized commit.

##### `src/options/options.ts`

Replace direct write paths:

- row-level delete buttons
- “clear pipelines”
- “clear snapshots”
- “clear dismissed”

These should also become service-worker messages so the options page cannot race background prune/poll.

##### Read consistency for popup/options

For consistency after cleanup:

- prefer a `GET_MONITORING_STATE_OVERVIEW` message that returns the normalized current state after the queued mutation commits
- after a mutation response, popup/options should rerender from the response payload rather than doing their own independent multi-key read
- also add a `chrome.storage.onChanged` listener in popup/options to refresh if a background prune finishes while the page is open

That satisfies the spec requirement that popup/options must not keep rendering a just-pruned item after the same cleanup pass.

##### Poll/write interaction

`runPoll()` should not keep doing per-snapshot direct storage mutations from arbitrary async points.

Recommended shape:

1. Fetch ADO data outside the queue.
2. Build an in-memory list of proposed snapshot updates keyed by canonical monitoring key.
3. Enter `mutateMonitoringState('apply poll results', ...)`.
4. Re-read the latest state inside the mutator.
5. Apply only updates whose matching `PipelineConfig` still exists at commit time.
6. Update `lastPolledAt`.
7. Optionally run the prune helper in the same queued commit, or enqueue prune immediately after.
8. Write the final collections in one commit.

This avoids both failure modes:

- popup/options cannot interleave their own writes with poll/prune
- a config removed while network fetches are in flight does not get resurrected by a stale poll write

---

##### 3) `dismissed_builds` schema + legacy migration without silent data loss

The revised persisted shape is:

```ts
export interface DismissedBuild extends MonitoringKey {
  dismissedAt: number;
}
```

##### Write semantics

- when the user clicks “Don’t monitor this build”, persist `{ ...key, dismissedAt: Date.now() }`
- when the user starts monitoring that same build, remove the matching dismissed record by canonical key

##### Legacy migration choice

Legacy records that have the old shape (`MonitoringKey` only, no `dismissedAt`) must **not** be treated as immediately expired.

Chosen migration:

- on the first service-worker-owned read/mutation that encounters a legacy dismissed record, backfill it to:

```ts
{ ...legacyKey, dismissedAt: now }
```

- persist that migrated value in the same serialized write cycle before prune expiry checks remove anything

##### Why this is the safest policy

- it avoids silently erasing a real user dismissal on upgrade
- it gives the user a fresh 12-hour grace period, which is conservative but predictable
- it does not invent historical timing from unrelated signals such as `last_polled_at`
- it preserves the product meaning of “user explicitly dismissed this build” better than immediate deletion

##### Duplicate handling during migration

If both a legacy and new-shape dismissed record exist for the same canonical key:

- keep one record per canonical key
- preserve the **newest** `dismissedAt`

That ensures migration never shortens a still-valid dismissal window.

##### `src/utils/storage.ts`

Update normalization so dismissed reads can recognize both shapes:

- valid new shape → keep as-is
- valid old shape without `dismissedAt` → mark as legacy and let background migration backfill it
- invalid/non-key shape → drop

Do **not** keep the old behavior where missing timestamp implies “expired now.”

---

##### 4) Snapshot lifecycle metadata is optional until refreshed

This needs to be explicit because the current installed base already has snapshots without the new lifecycle fields.

##### `src/types/ado.ts`

Extend `BuildSnapshot` with optional lifecycle metadata:

```ts
export interface BuildSnapshot extends MonitoringKey {
  stages: Record<string, StageSnapshot>;
  buildStatus?: string;
  buildFinishedAt?: number;
  lastSuccessfulPollAt?: number;
}
```

##### `src/background/poller.ts`

On every successful snapshot refresh, populate:

- `buildStatus = build.status`
- `buildFinishedAt = parsed build.finishTime` when present/valid
- `lastSuccessfulPollAt = Date.now()`

##### Explicit retention rule for old snapshots

If a snapshot still has a matching monitored-build config **but lacks the new lifecycle metadata**, it is **not prune-eligible yet**.

Concrete prune behavior:

- matching config exists + snapshot metadata missing  
  → retain config and snapshot until the next successful poll rewrites the snapshot

- matching config exists + `buildStatus !== 'completed'`  
  → retain config and snapshot

- matching config exists + any watched stage has `approvalPending === true`  
  → retain config and snapshot

- matching config exists + `buildStatus === 'completed'`  
  → prune only if `(buildFinishedAt ?? lastSuccessfulPollAt) <= cutoff`

- no matching config exists  
  → snapshot is an orphan and is prune-eligible regardless of lifecycle metadata age

That last rule preserves the product/spec requirement that orphan snapshots must not linger indefinitely.

##### Why this is correct

- we do not guess completion state for an old snapshot we have never observed in the new format
- we do not risk deleting an active approval-pending build just because its old snapshot lacks metadata
- we still clean up true orphan snapshots immediately

---

#### Revised prune algorithm

Implement the core as a pure helper used only from the background state coordinator:

```ts
pruneMonitoringState(now, state): {
  nextState: MonitoringStateData;
  changed: boolean;
}
```

##### Inputs available to the helper

- `pipelineConfigs`
- `buildSnapshots`
- `dismissedBuilds`
- `cutoff = now - 12h`

##### Algorithm

1. Build canonical-key maps for:
   - configs
   - snapshots
   - dismissed records

2. For each dismissed record:
   - if it came from a legacy entry, it should already have been backfilled to `dismissedAt: now` by the enclosing serialized mutation
   - keep only records with finite `dismissedAt` and `dismissedAt > cutoff`

3. For each monitored config:
   - if no snapshot exists, retain the config for now
   - if snapshot exists but lacks lifecycle metadata, retain config + snapshot
   - if snapshot shows any watched-stage `approvalPending`, retain config + snapshot
   - if `snapshot.buildStatus !== 'completed'`, retain config + snapshot
   - otherwise derive `terminalAnchor = snapshot.buildFinishedAt ?? snapshot.lastSuccessfulPollAt`
   - if `terminalAnchor` is not finite, retain
   - if `terminalAnchor <= cutoff`, prune the config

4. For snapshots:
   - if the canonical key is still retained by a config, keep the snapshot
   - if the config was retained because the snapshot metadata is still legacy/incomplete, keep the snapshot
   - otherwise prune the snapshot as expired or orphaned

5. Return the fully rewritten collections; commit them together in one background write

##### Atomicity rule

Whenever prune changes anything, commit the resulting monitored collections in one `chrome.storage.local.set(...)` call from the service worker.

---

#### Module-by-module change list

##### `src/types/ado.ts`

- add `MonitoringKeyLike`
- add `toMonitoringKey()`
- change `monitoringKeyToString()` to canonicalize to four fields only
- extend `BuildSnapshot` with optional lifecycle fields
- add `DismissedBuild` interface (or export it from `background/state.ts` if preferred, but shared typing in `types/ado.ts` is cleaner)

##### `src/utils/storage.ts`

- update `normalizeBuildSnapshot()` to preserve optional lifecycle metadata when valid
- add `normalizeDismissedBuild()` that can detect legacy vs timestamped dismissed shapes
- keep low-level read/write helpers, but treat them as background-owned for monitored-state writes
- keep `dedupeByKey()` on the canonical key helper only

##### `src/background/state.ts`

- replace per-snapshot direct helpers with background-owned monitoring-state coordinator helpers
- add serialized `mutateMonitoringState()`
- add pure in-memory helpers:
  - `upsertSnapshotInCollection()`
  - `removeSnapshotFromCollection()`
  - `pruneMonitoringState()`
  - `migrateLegacyDismissedBuilds()`

##### `src/background/poller.ts`

- collect poll results
- commit them through `mutateMonitoringState()`
- populate `buildStatus`, `buildFinishedAt`, `lastSuccessfulPollAt`
- before saving a snapshot, re-check that the config still exists in current state

##### `src/background/service-worker.ts`

- register a dedicated prune alarm (for example `devops-prune`, hourly)
- route all monitored-state mutation messages through `mutateMonitoringState()`
- continue handling `FORCE_POLL`, but ensure its commit path also uses the same queue
- run prune on install/startup and on the prune alarm via the same queue

##### `src/popup/popup.ts`

- replace direct monitored-state writes with runtime messages
- remove direct import/use of `clearSnapshot()` from popup context
- rerender from returned background state after mutations
- optionally subscribe to `chrome.storage.onChanged` for live refresh while open

##### `src/options/options.ts`

- replace row deletion / clear actions with runtime messages
- use canonical key strings only for row identity
- rerender from message response or refresh on `storage.onChanged`

---

#### Review-focused test plan for later implementation

Basher/Livingston should expect tests for:

- canonical key equality between:
  - `PipelineConfig`
  - `BuildSnapshot` with extra lifecycle fields
  - `DismissedBuild` with `dismissedAt`
- legacy dismissed record migration grants a fresh retention window instead of immediate prune
- legacy snapshot metadata missing + matching config => retained
- orphan snapshot + missing metadata => pruned
- terminal completed snapshot uses `buildFinishedAt`
- terminal completed snapshot missing `buildFinishedAt` uses `lastSuccessfulPollAt`
- non-terminal builds are never pruned
- approval-pending builds are never pruned
- popup/options mutations routed through service worker do not lose concurrent poll/prune updates
- poll result for a config removed mid-flight is discarded at commit time

---

#### Plain-text summary of Basher’s four blocking gaps

1. **Canonical keying resolved:** `monitoringKeyToString()` is revised to serialize only `{org, project, pipelineId, buildId}` via a shared `toMonitoringKey()` helper, and every dedupe/match/delete/prune path must use that canonical identity instead of stringifying whole objects.

2. **Cross-context serialization resolved:** all monitored-state mutations move behind `chrome.runtime.sendMessage(...)` to the MV3 service worker, which becomes the single writer and serializes poll/prune/popup/options mutations through one `mutateMonitoringState()` queue with atomic multi-key commits.

3. **Legacy `dismissed_builds` migration resolved:** old records without `dismissedAt` are backfilled to `dismissedAt = now` the first time the service worker encounters them, then persisted before expiry checks, giving upgrading users a fresh 12-hour grace period instead of silent dismissal loss.

4. **Legacy snapshot metadata resolved:** snapshots missing `buildStatus`, `buildFinishedAt`, or `lastSuccessfulPollAt` are explicitly retained while their monitored config still exists and are not pruned until a later successful poll populates those fields; orphan snapshots remain prune-eligible immediately.

### 2026-09-15: Stale-data cleanup implementation notes
**By:** Linus
**What:** Implemented stale-data cleanup with a canonical four-field monitoring-key helper, service-worker-owned monitoring-state mutations, snapshot lifecycle metadata, dismissed-build timestamp migration/backfill, prune scheduling (startup/install, hourly alarm, on-write), and Jest coverage for prune/migration/key-correlation behavior.
**Why:** This matches the approved design while removing the popup/options vs service-worker storage race and keeping cleanup decisions anchored to terminal-build lifecycle data.

#### 2026-09-15: Popup/options trigger a background cleanup handshake before rendering
**By:** Linus
**What:** Popup and options now send `GET_MONITORING_STATE_OVERVIEW` to the service worker before their normal storage-backed render pass. The UI still reads normalized storage for display, but this handshake forces legacy dismissed-build backfill and a prune pass before the user sees state.
**Why:** It preserves the approved single-writer migration/cleanup boundary without rewriting every read path into a message-only data flow in the same change.

### 2026-09-15: Fix stale-data UI copy regression coverage
**By:** Linus
**What:** Updated the shipped popup and options templates to use the approved **"Monitored builds"** copy, and changed `src/popup/popup.test.ts` to load the real `src/popup/popup.html` template from disk instead of using an inlined DOM fixture. Added a focused assertion that the shipped popup template still contains the approved label.
**Why:** Basher's rejection was correct: the runtime UI still shipped the old **"Monitored pipelines"** copy even though tests passed. The root cause was fixture drift — the popup test hardcoded corrected markup, so it never exercised the actual HTML file. Loading the real template closes that gap and will fail fast if the shipped popup copy regresses again.

### 2026-09-15: Stale-data cleanup Jest coverage scaffolded from spec/design
**By:** Livingston
**What:** Rewrote `src/background/pruner.test.ts` so it now imports and exercises the real `src/background/state.ts` exports (`pruneMonitoringState`, `migrateLegacyDismissedBuilds`, `runStaleDataPrune`, `readMonitoringState`) instead of leaning on local stand-in types/helpers. Coverage now verifies all original stale-data acceptance scenarios against production code, while `src/background/state.test.ts` remains focused on snapshot CRUD behavior. I also kept the adjacent Jest expectation updates in `src/background/poller.test.ts`, `src/background/state.test.ts`, `src/utils/storage.test.ts`, and `src/popup/popup.test.ts` aligned with the shipped timestamped-dismissal/snapshot-metadata/service-worker-write-path behavior.
**Why:** The first draft of `pruner.test.ts` was written before Linus's real module shape settled. Once `state.ts` landed, the test needed to prove the real implementation, not a locally mirrored expectation model. After the rewrite, both `npm test` and `npm run build` pass, and the subtle orphan-snapshot / retained-snapshot cases are explicitly verified against the shipped prune logic.

### 2026-09-15: Scope audit of stale-data cleanup implementation
**By:** Basher
**What:** Audited the staged stale-data cleanup diff for proportionality against the approved spec (`.squad/specs/stale-data-cleanup-spec.md`) and the approved implementation revision merged into `.squad/decisions.md`.
**Why:** The feature ask is small ("delete records older than 12 hours"), but the staged diff is large enough that it may have drifted from housekeeping into architecture refactor.

#### Bottom line

My honest verdict: **the final implementation is technically coherent but over-scoped for the product ask**. The pruning behavior itself is reasonable. The size comes from an implementation-safety refactor that turned a cleanup feature into a broader **monitoring-state architecture change**:

- canonical keying across config/snapshot/dismissed state
- new background state coordinator
- service-worker single-writer message bus
- popup/options write-path rerouting
- poller commit-path restructuring
- large new regression coverage scaffold

That architecture is defensible if the team explicitly wanted to fix MV3 cross-context races now. But for the user-visible feature "delete stale records after 12 hours," it is **more machinery than the feature strictly needed**.

#### File-by-file scope audit

##### `src/background/poller.ts` (+303/-184; 487 changed lines)
- **Required by approved design?** **Partly.**
- **Actually needed for cleanup:** yes, but only the pieces that persist lifecycle metadata (`buildStatus`, `buildFinishedAt`, `lastSuccessfulPollAt`) and commit snapshot writes through the new serialized state path so prune/poll do not race or resurrect deleted configs.
- **What changed:** the file was substantially restructured. Snapshot creation, approval detection, previous-stage lookup, notification construction, and final state commit were all split into new helper layers. Polling now stages remote fetch results in memory and applies them later inside `mutateMonitoringState(...)`.
- **Why the diff is so large:** not just pruning. It includes:
  - queue-based commit restructuring for poll results
  - helper extraction/refactor (`buildStageSnapshots`, `buildNotifications`, `findPreviousStage`, etc.)
  - whole-file formatting churn (quote/indent/style changes)
  - an unrelated approval robustness fix (`pipeline.owner.id` can be string)
- **My scope call:** this file **did need touching**, but **not this much**. Roughly:
  - **in scope:** lifecycle metadata capture + serialized commit path
  - **out-of-scope churn:** helper reshaping, formatting rewrite, case-insensitive previous-stage fallback, and the ADO owner-id string fix

##### `src/background/poller.test.ts` (+41/-2)
- **Required by approved design?** **Partly.**
- Needed updates to assert snapshot metadata persistence and new queued-write behavior.
- The added test for approvals when ADO serializes `pipeline.owner.id` as a string is a **good bug test**, but it is **not a stale-data-cleanup test**. That is adjacent opportunistic hardening.
- **Scope call:** mostly justified, with one clearly unrelated extra test.

##### `src/background/service-worker.ts` (+165/-30; 195 changed lines)
- **Required by approved design?** **Partly to mostly, because the approved revision explicitly chose service-worker single-writer routing.**
- **Actually needed for cleanup:** the new hourly `devops-prune` alarm and a way to trigger prune on startup/install are clearly in scope. Some background-owned mutation handling follows directly from the approved design revision.
- **What is broader than the feature:** this file is no longer just poll/alarm wiring; it becomes a **general monitoring-state command bus** with handlers for upsert/remove/dismiss/undismiss/delete/clear actions and generic `mutateAndRespond(...)`.
- **Unrelated/broad churn I would call out:**
  - `chrome.alarms.clearAll()` on install is broader than needed; clearing the known alarms would have been safer and more scoped.
  - module-load `registerAlarms()` + module-load `runStaleDataPrune()` is extra startup behavior beyond the original simple worker pattern.
- **My scope call:** if you accept the approved single-writer design, this file follows from it. But that design choice itself is the moment the feature became oversized.

##### `src/background/state.ts` (+258/-13; 271 changed lines)
- **Required by approved design?** **Yes, largely.**
- This is the real feature core:
  - legacy `dismissed_builds` migration/backfill
  - prune algorithm
  - canonical-key-based correlation
  - serialized monitoring-state mutation queue
  - atomic multi-key writes
- **Speculative/generalized parts:** mild, but present.
  - `cloneState()` is dead/unused.
  - the module now looks like a small state-management framework rather than a focused prune module.
- **My scope call:** mostly justified by the approved implementation revision; still more architectural than the base product ask required.

##### `src/background/state.test.ts` (+31)
- **Required by approved design?** **Yes.**
- Seeding configs became necessary because snapshot writes now run through prune-aware state logic; otherwise the old tests would no longer reflect real behavior.
- **Scope call:** justified and modest.

##### `src/background/pruner.test.ts` (+509 new)
- **Required by approved design?** **Mostly yes once `state.ts` was introduced.**
- It directly covers the approved rules: 12-hour TTL, active/approval exemptions, fallback timestamp, orphan snapshots, migration, idempotence, and real storage-backed prune.
- The file is **very large** relative to the product ask, but it is at least testing the real module, not fantasy scaffolding.
- Mild scope bloat: service-worker trigger tests are bundled in here instead of a focused service-worker test file.
- **Scope call:** heavy but purposeful; this size is a consequence of the architectural solution, not of pruning alone.

##### `src/types/ado.ts` (+50/-3; 53 changed lines)
- **Required by approved design?** **Mostly yes.**
- In-scope changes:
  - canonical `MonitoringKeyLike` / `toMonitoringKey()` / `monitoringKeyToString()`
  - `DismissedBuild` / `StoredDismissedBuild`
  - optional lifecycle metadata on `BuildSnapshot`
- Out-of-scope change:
  - `AdoApproval.pipeline.owner.id` widened to `number | string` is an unrelated approval-payload robustness fix.
  - `parseMonitoringKeyString()` is only needed because the UI now serializes keys into message-routing data attributes; useful, but created by the broader refactor.
- **Scope call:** mostly justified, with one clear non-pruning bugfix piggybacked in.

##### `src/types/ado.test.ts` (+42 new)
- **Required by approved design?** **Yes.**
- Canonical-key equality across config/snapshot/dismissed shapes is core to the approved revision.
- **Scope call:** proportionate.

##### `src/utils/storage.ts` (+63/-8; 71 changed lines)
- **Required by approved design?** **Yes.**
- Needed to normalize/persist the new snapshot lifecycle metadata and timestamped dismissed records, while tolerating legacy dismissed entries.
- **Scope call:** justified.

##### `src/utils/storage.test.ts` (+4/-1)
- **Required by approved design?** **Yes.**
- Small adjustment for timestamped dismissed entries.
- **Scope call:** justified.

##### `src/popup/popup.ts` (+35/-27; 62 changed lines)
- **Required by approved design?** **Partly.**
- The approved revision explicitly required popup writes to route through the service worker and to refresh after cleanup. So these changes do match the approved HOW.
- But relative to the user-visible stale-data feature, this is where the solution becomes obviously architectural:
  - direct write paths removed
  - new runtime message mutation path
  - new storage-change listener
  - startup handshake (`GET_MONITORING_STATE_OVERVIEW`)
- **Scope call:** consistent with the approved design, but the approved design is broader than the feature. For a small cleanup feature, this is substantial collateral movement in a user-facing file.

##### `src/popup/popup.html` (+1/-1)
- **Required by approved spec/design?** **Yes.**
- Copy change from "Monitored pipelines" to "Monitored builds" was explicitly required.
- **Scope call:** fully justified.

##### `src/popup/popup.test.ts` (+51/-29; 80 changed lines)
- **Required by approved spec/design?** **Yes, partly because the previous review caught a real regression hole.**
- Loading the real `popup.html` from disk is directly justified.
- The larger mocking scaffolding exists because popup writes were rerouted through the service worker/state queue. That test complexity is downstream cost from the broader architecture change.
- **Scope call:** justified after the earlier UI-copy miss, but again inflated by the message-routing refactor.

##### `src/options/options.ts` (+38/-17; 55 changed lines)
- **Required by approved design?** **Partly.**
- The approved revision did say options-page mutations should also route through the service worker so they do not race prune/poll.
- From a pure stale-data feature perspective, though, this is scope expansion into an admin/storage screen.
- **Scope call:** aligned to the approved HOW, but not to a minimal "expire old records" implementation.

##### `src/options/options.html` (+1/-1)
- **Required by approved spec/design?** **Yes.**
- Copy change to "Monitored Builds" is in scope.
- **Scope call:** justified.

#### Direct answers to the key audit questions

##### 1) Was `poller.ts` even supposed to be touched?
**Yes, but narrowly.** The approved design required poller-written snapshots to carry lifecycle metadata and to avoid stale poll writes racing cleanup. That justified touching `poller.ts`.

**What was not justified by the feature itself:** the extra helper refactor, formatting rewrite, and unrelated approval bugfix. Those made the file look far bigger than the pruning requirement alone.

##### 2) How much of `service-worker.ts` is prune wiring vs unrelated restructuring?
Real prune wiring is a minority of the file:
- add `devops-prune` alarm
- run prune on install/startup/alarm
- possibly add one or two messages for prune entry points

Most of the added surface is the **single-writer routing layer** for all monitored-state mutations. That is architecture, not just stale-data cleanup.

##### 3) Is the single-writer popup/options → service worker refactor proportionate?
**My answer now: no, not for this product ask.**

It is the safest design if the team decides MV3 cross-context write races must be solved immediately and comprehensively. But as a response to "delete records older than 12 hours," it is too much ceremony:

- it touches popup, options, service worker, poller, state, storage, and tests
- it introduces a quasi-API surface for internal state mutation
- it inflates both production code and test scaffolding

A simpler implementation could have accepted limited race risk in this single-user local extension, or scoped the synchronization fix more narrowly to prune/poll interactions without rerouting every UI mutation through a service-worker command layer.

##### 4) Any abstractions/helper layers that do not serve this feature?
Yes:
- `poller.ts` helper extraction goes beyond what pruning needed.
- `AdoApproval.owner.id` string support is a separate bug fix.
- `parseMonitoringKeyString()` and some of the message plumbing are second-order complexity created by the routing refactor.
- `cloneState()` in `state.ts` is dead code.
- `service-worker.ts` is generalized into a broader mutation broker rather than a focused stale-data hook.

None of these are catastrophic, but together they are evidence that the change grew beyond housekeeping.

#### Total verdict

Given the actual ask — **"delete records older than 12 hours"** — the staged implementation is **over-engineered**.

Important nuance: it is not nonsense engineering. The code follows the approved revised design, and much of the size is a consequence of solving real safety concerns I previously raised. But that means **my earlier design approval helped bless a broader architectural response than this feature really warranted**.

If I strip it down to product need versus code moved:
- **Needed core:** canonical keying, timestamped dismissed records, snapshot lifecycle metadata, prune helper, prune alarm, targeted tests.
- **What pushed it over the line:** full single-writer refactor, broad poller reshaping, UI mutation rerouting, and extra opportunistic fixes.

So my concrete opinion is:

> **The final diff is not proportionate to the feature ask.** It is a sound medium-sized refactor carrying a small cleanup feature, not a small cleanup feature implemented simply.

#### Plain-text summary

Verdict: the stale-data cleanup implementation works toward the approved design, but the approved design itself was too broad for the ask. The core pruning logic is in scope; the service-worker single-writer refactor, broad poller rewrite, UI mutation rerouting, and unrelated approval hardening make the final ~1600+ src-line change set over-engineered for “delete records older than 12 hours.”

### 2026-09-15: Stale-data cleanup scope audit
**By:** Rusty
**What:** Audited the just-implemented stale-data cleanup feature against the original ask and current staged scope. Verdict: the product rule is simple, but the implementation grew into a broader state-architecture hardening pass. Some of that hardening solves real bugs; some of it is disproportionate for a private pre-1.0 Chrome extension.
**Why:** `git --no-pager diff --cached --stat` shows this is no longer a small retention feature. The staged scope now spans 24 files / 2648 insertions, with especially large churn in `src/background/poller.ts`, `src/background/service-worker.ts`, `src/background/state.ts`, `src/types/ado.ts`, `src/popup/popup.ts`, `src/options/options.ts`, and new prune-focused tests. That is materially larger than “delete records older than 12 hours.”

#### 1) Single-writer via service-worker message passing

Bluntly: **useful, but not strictly necessary for this ask**.

There is a real race in the old model: popup/options/service worker all did blind read-modify-write against the same arrays. Basher was right that the race exists. But the question is not “is there any race?” — it is “does this feature need a repo-wide mutation architecture change right now?”

My answer: **probably not**.

Why I think it is disproportionate here:
- this is a **single-user local extension**, not a multi-client distributed system
- popup/options writes are human-paced and infrequent
- the likely failure mode was stale/orphaned entries or a lost delete, not catastrophic corruption
- prune itself could have been made idempotent and conservative without forcing every UI mutation through the service worker

What was the simplest thing that could have worked:
1. keep popup/options direct writes for now
2. add one background-only prune pass on startup + hourly alarm + after poll
3. give poll a **targeted commit-time recheck** so it refuses to save a snapshot if the matching config was removed while fetches were in flight
4. optionally have popup/options call `RUN_STALE_DATA_PRUNE` (or equivalent) before rendering, without also routing all writes through messages

That would have handled the feature itself with much less churn. The single-writer refactor is a **premature robustness move** unless the team intended to use this feature as the trigger for a deliberate storage-architecture cleanup.

#### 2) Canonical-key-everywhere refactor

This one is **more justified**.

Once `BuildSnapshot` gained lifecycle fields and dismissed records gained `dismissedAt`, whole-object `JSON.stringify(...)` stopped being a safe identity function across config/snapshot/dismissed shapes. That is not theoretical. It would have produced wrong matches and wrong prune behavior.

That said, the broadness is still arguable. A narrower fix could have sufficed:
- add one canonical four-field projection/helper
- use it only in cross-type correlation seams:
  - prune matching
  - snapshot upsert/remove
  - dismissed dedupe/remove
  - options row identity parsing/serialization where needed

So my assessment is:
- **canonical key helper itself:** necessary
- **repo-wide canonical-key cleanup:** mostly reasonable, but could have been kept tighter

Compared with the single-writer refactor, this part feels proportionate.

#### 3) Complexity of prune logic in `state.ts`

The **core prune rule** is not outrageous. Given the approved behavior, a prune helper really does need to handle:
- 12h TTL for dismissed records
- active/non-terminal exemption
- approval-pending exemption
- `finishTime ?? lastSuccessfulPollAt` fallback
- orphan snapshot cleanup
- repeated safe/idempotent runs

So the pure `pruneMonitoringState(...)` idea is fine.

Where it becomes heavier than the ask is everything wrapped around it:
- `migrateLegacyDismissedBuilds(...)`
- `readRawMonitoringState(...)`
- `readMonitoringState(...)`
- `writeMonitoringState(...)`
- queued `mutateMonitoringState(...)`
- message-driven UI mutation flow
- `runStaleDataPrune()` doing a no-op mutation just to force queueing/prune/write

That is a lot of ceremony around a housekeeping rule. There is also at least one tell that the module accreted layers faster than it was simplified: `cloneState()` exists but is unused.

So my view is:
- **prune logic itself:** reasonable
- **state.ts as the feature host:** over-layered for “delete old stuff after X hours”

#### 4) Legacy migration/backfill vs the 2026-09-04 pre-1.0 decision

Yes, there is a **real tension**, and we should admit it plainly.

On 2026-09-04 the team explicitly dropped pre-1.0 storage migration compatibility because the project is private and still `0.1.0`. Eleven days later this feature reintroduced migration/backfill behavior for `dismissed_builds`.

The distinction is understandable:
- previous migration code preserved malformed/old monitoring shapes broadly
- this new backfill tries to preserve a **real explicit user action** (“don’t monitor this build”)

But in practice it is still a reversal of posture. We said “no migration compatibility needed pre-1.0,” then added fresh compatibility logic as soon as the new feature touched user-visible stored state.

My honest take:
- **legacy snapshot retention until refreshed** is acceptable and not too heavy; it is mostly “treat missing metadata conservatively”
- **persisted dismissedAt backfill/migration** is the part that directly conflicts with the earlier decision

For pre-1.0/private software, a simpler stance would have been defensible:
- new dismissals get `dismissedAt`
- legacy dismissed records get dropped or treated as expired on first cleanup
- document that there is no compatibility promise yet

That is harsher, but it is consistent with the 2026-09-04 decision. The current implementation chose user-state preservation over that prior principle.

#### 5) Verdict: over-engineered or not?

**Verdict: yes, overall this feature is over-engineered relative to the ask.**

Not because every added piece is wrong. Some are sensible:
- snapshot lifecycle metadata was needed
- canonical keying needed fixing
- background prune scheduling via alarms is appropriate

But the feature became a vehicle for a much broader cleanup:
- single-writer mutation coordinator
- popup/options message protocol
- background handshake before rendering
- migration/backfill policy
- large poller refactor
- large new test scaffold

That bundle is bigger than the problem statement warranted.

#### Simpler version I would recommend instead

If I were re-scoping this today, I would recommend:

1. **Keep the product rule exactly as approved**
   - monitored builds/snapshots expire 12h after terminal completion
   - dismissed builds expire 12h after dismissal
   - active/approval-pending builds are exempt

2. **Add only the minimum new data**
   - `BuildSnapshot.buildStatus`
   - `BuildSnapshot.buildFinishedAt`
   - `BuildSnapshot.lastSuccessfulPollAt`
   - `DismissedBuild.dismissedAt` for new writes only

3. **Fix keying narrowly but correctly**
   - canonical four-field helper in `src/types/ado.ts`
   - use it in prune/upsert/delete/dedupe paths
   - do not turn this into a generalized cross-context architecture rewrite

4. **Implement one background prune function**
   - read `pipeline_configs`, `build_snapshots`, `dismissed_builds`
   - prune in memory
   - write the three keys back in one `chrome.storage.local.set(...)`
   - run it on startup, hourly alarm, and after successful poll

5. **Handle poll/write race with a narrow fix**
   - before committing a snapshot, re-read current configs (or re-check inside one local poll commit) and skip snapshot save if the config no longer exists

6. **Do not do migration/backfill persistence pre-1.0**
   - either drop legacy dismissed records on first prune or explicitly accept that old dismissed data has no retention guarantee
   - keep missing snapshot lifecycle metadata as “retain until refreshed” if we want the safer side

7. **Leave popup/options direct writes alone for now**
   - at most trigger a prune-on-open handshake before rendering
   - defer full single-writer architecture until we see actual user pain or choose to do a separate storage-state refactor

That version would still solve the stale-data problem, still be safe enough for this product stage, and would have been much closer to the simplicity the ask implies.

#### Bottom line

The current implementation is not nonsense. It is a coherent solution to real edge cases. But it is also **larger and more architectural than the feature strictly needed**, and it reintroduced migration logic shortly after we explicitly decided pre-1.0 compatibility was not worth carrying. If the goal was “ship stale cleanup simply,” we overshot.

### 2026-09-15: Simplify stale-data cleanup back to the approved minimum
**By:** Linus
**What:** Reverted the popup/options single-writer message routing and restored direct `chrome.storage.local` writes through storage helpers, with popup/options now using the shared prune helper only on initial load. Trimmed `src/background/service-worker.ts` back to poll/test handling plus the retained stale-data hooks (hourly `devops-prune` alarm, prune on install/startup, prune-before-install-triggered poll). Simplified `src/background/state.ts` by removing the queued mutation broker and dropping legacy `dismissed_builds` backfill; legacy dismissed records without `dismissedAt` now fall out on the first prune pass. Trimmed `src/background/poller.ts` back toward its original flow while keeping the required snapshot lifecycle metadata (`buildStatus`, `buildFinishedAt`, `lastSuccessfulPollAt`). Updated tests to reflect the narrower implementation while preserving coverage for TTL pruning, active/approval exemptions, orphan snapshot cleanup, startup/alarm triggers, and the separate owner-id bugfix.
**Why:** Basher and Rusty were right that the previous implementation solved the feature with too much architecture churn. The approved behavior is still intact, but the write-path broker, queue wrapper, and legacy migration grace window were not justified for a private pre-1.0 extension. After restaging the simplified implementation, the staged **src-only** feature diff is now **15 files / 1193 insertions / 286 deletions** (1479 touched lines) versus the earlier ~1600+ src-line / 15-file version. Largest shrink points: `service-worker.ts` 195→85 changed lines, `state.ts` 271→173, `poller.ts` 487→365, `popup.ts` 62→37, `options.ts` 55→36, and `popup.test.ts` 80→42. The full staged diff remains larger because prior Squad decision/spec files are still part of the uncommitted change set (`git diff --cached --stat`: 24 files / 2249 insertions / 301 deletions).

### 2026-09-15: Keep ADO approval owner-id widening as a standalone bugfix
**By:** Linus
**What:** Kept the `AdoApproval.pipeline.owner.id` widening to `number | string` in `src/types/ado.ts` as its own bugfix. Azure DevOps sometimes serializes `approval.pipeline.owner.id` as a string instead of a number; without handling both, approval matching in `src/background/poller.ts` can fail or mis-attribute a pending approval to the wrong build run.
**Why:** This defect is real and independent of stale-data pruning. It affects approval detection correctness even if no retention cleanup exists. Coverage remains in `src/background/poller.test.ts` via the test `matches approvals when ADO serializes the build owner id as a string`.

### 2026-09-15: Review of Linus stale-data simplification pass
**By:** Basher
**Verdict:** **APPROVE**

I re-read the active decision entry, the original product spec, Linus's simplification note, and the separate owner-id bugfix note, then reviewed the staged diff and independently ran `npm test` and `npm run build`.

#### Check results

1. **Single-writer mutation bus removed:** confirmed. `src/popup/popup.ts` and `src/options/options.ts` are back to direct storage-helper writes. The only remaining `chrome.runtime.sendMessage(...)` calls are the existing `FORCE_POLL` and `TEST_NOTIFICATION` actions. `src/background/service-worker.ts` no longer exposes mutation handlers for monitoring state.
2. **Prune scheduling preserved:** confirmed. `src/background/service-worker.ts` still registers hourly `devops-prune`, runs prune on install, runs prune on startup, and runs prune before the install-triggered poll.
3. **`poller.ts` scope:** much better. The broad queued-mutation rewrite is gone. The remaining functional additions are the required snapshot lifecycle metadata (`buildStatus`, `buildFinishedAt`, `lastSuccessfulPollAt`) plus the separately documented owner-id bugfix. What remains beyond pruning is small and justified.
4. **Original acceptance criteria:** covered in code and tests. `src/background/state.ts` + `src/background/pruner.test.ts` preserve completion-anchored 12h expiry, non-terminal/approval-pending retention, orphan snapshot pruning, retained-snapshot safety, and 12h dismissed-build expiry.
5. **Legacy dismissed records without `dismissedAt`:** confirmed dropped on first prune, not backfilled. This is explicitly tested and is consistent with the archived 2026-09-04 pre-1.0 no-migration decision.
6. **`cloneState()` dead code:** removed; no remaining references in `src/`.
7. **Owner-id bugfix separation:** real and correctly separated in documentation. `src/types/ado.ts` widens `AdoApproval.pipeline.owner.id` to `number | string`; `src/background/poller.ts` normalizes it numerically before matching; `src/background/poller.test.ts` has a dedicated passing test: `matches approvals when ADO serializes the build owner id as a string`.
8. **Regression check:** passed. `npm test` => 7/7 suites, 51/51 tests passed. `npm run build` => webpack production build succeeded.
9. **Updated proportionality call:** this is now close enough to the actual ask. The major over-engineering (service-worker mutation broker / UI reroute architecture) is gone. The remaining diff is still not tiny because pruning needs types, storage normalization, tests, and lifecycle metadata, but it is no longer an architecture detour disguised as housekeeping.

#### Reviewer notes

- I do still see a little residual non-pruning surface (`parseMonitoringKeyString()` is now only exercised by its unit test), but that is not a blocker.
- The important thing is that the simplification directive was actually followed in the live code, not merely described in notes.

#### Validation run

- `npm test` ✅
- `npm run build` ✅

#### Bottom line

Approved. This revision keeps the required stale-data behavior, preserves the standalone owner-id bugfix with its own test/documentation, removes the disproportional single-writer refactor, and is now proportionate enough to merge.

### 2026-09-15: Re-verified stale-data-cleanup coverage after simplification
**By:** Livingston
**What:** Re-ran the stale-data cleanup, popup, poller, full Jest, and production build checks after Linus simplified the implementation. `src/background/pruner.test.ts` still exercises the real production prune logic in `src/background/state.ts` (direct import for pure prune checks plus the storage-backed `runStaleDataPrune()` integration case). The legacy dismissed-build scenario was correctly updated: records in `dismissed_builds` without `dismissedAt` are now dropped on the first prune pass instead of receiving a grace window. `src/background/poller.test.ts` still contains the standalone owner-id regression test (`matches approvals when ADO serializes the build owner id as a string`) and it passes. `src/popup/popup.test.ts` passes against the restored direct-storage flow. I found no dedicated options-page test file in `src/`; options behavior currently has build coverage but no page-level Jest coverage to re-run. Popup test scaffolding no longer mocks service-worker write-routing, but it still contains a harmless `chrome.runtime.sendMessage` default stub that is no longer exercised by the covered popup paths.
**Why:** The simplification intentionally removed the single-writer/message-routing path and the legacy dismissed-build grace-window behavior, so QA needed an independent rerun against the unchanged acceptance criteria (with AC #8 updated to the approved drop-on-expire rule) plus confirmation that the separate owner-id bugfix did not get lost during the poller trim-back.

#### Commands run
- `npm test -- --runTestsByPath src/background/pruner.test.ts`
- `npm test -- --runTestsByPath src/popup/popup.test.ts`
- `npm test -- --runTestsByPath src/background/poller.test.ts`
- `npm test`
- `npm run build`

#### Acceptance-criteria scenario status (11/11 passing)
1. **Pass** — completed monitored build older than 12 hours is pruned with its snapshot.
2. **Pass** — completed monitored build newer than 12 hours is retained.
3. **Pass** — in-progress / approval-pending monitored builds are retained regardless of age.
4. **Pass** — terminal build without usable `finishTime` falls back to `lastSuccessfulPollAt`.
5. **Pass** — orphan snapshots are pruned.
6. **Pass** — retained monitored builds keep their current snapshot.
7. **Pass** — dismissed builds expire exactly 12 hours after `dismissedAt`.
8. **Pass** — legacy `dismissed_builds` records without `dismissedAt` are treated as already expired and dropped on first prune.
9. **Pass** — legacy snapshots without lifecycle metadata are retained until a later successful poll refreshes them.
10. **Pass** — prune is idempotent across repeated runs.
11. **Pass** — real storage-backed prune path persists the expected state through `runStaleDataPrune()`.

#### Additional verification
- Service-worker prune triggers still pass: hourly prune alarm registration, install/startup cleanup, and prune-alarm execution.
- Popup tests pass after returning to direct storage writes.
- No dedicated options-page Jest tests are present to re-run; this is a coverage gap, not a newly introduced failure.
- Full suite result: **7/7 suites passed, 51/51 tests passed**.
- Build result: **webpack production build passed**.
