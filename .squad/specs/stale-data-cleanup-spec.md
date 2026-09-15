# Stale Data Cleanup Spec

## Problem Statement
DevopsMonitor currently keeps monitored-build records and build snapshots in `chrome.storage.local` without any age-based expiry. Because the product monitors **specific Azure DevOps build runs**, not an evergreen pipeline subscription, old runs and their diffing snapshots can linger after they stop being useful. That increases storage noise, makes the UI's "Monitored builds" list less trustworthy, and leaves behind stale notification-deduping state.

## User Story
As a user, I want outdated monitored-build data to clean itself up after a reasonable retention window, so that DevopsMonitor only keeps monitoring state that is still relevant and does not accumulate stale build history forever.

## Domain Research

### What a "snapshot" is
- A snapshot is the extension's saved **diff cache** for one monitored build run.
- Source model: `BuildSnapshot` in `src\types\ado.ts`.
- Persistence: `chrome.storage.local` key **`build_snapshots`** via `src\utils\storage.ts`.
- Identity: `{ org, project, pipelineId, buildId }`.
- Payload: per-stage `state`, `result`, and `approvalPending`.
- Purpose: compare the current poll result to the previous poll result so duplicate notifications are not re-sent.

### What a "Monitored build" is in the current product
- In the current UI and README it is called a "Monitored pipeline", but the code stores a **specific monitored build run**.
- Source model: `PipelineConfig` in `src\types\ado.ts`.
- Persistence: `chrome.storage.local` key **`pipeline_configs`** via `src\utils\storage.ts`.
- Identity: the same `{ org, project, pipelineId, buildId }` tuple.
- Payload: `pipelineName` plus the selected watched stages.
- Important nuance: the product does **not** follow "latest builds" for a pipeline. It stays pinned to the exact build run the user selected.

### Related persisted state
- `dismissed_builds` stores build-run identities the user explicitly chose not to monitor.
- `last_polled_at` stores only the extension's most recent completed poll time.
- `notification_map` stores notification-id to build-URL mappings.

These related keys matter for product framing. With the final product decision, `dismissed_builds` is also in scope for the same retention policy.

## Staleness Definitions

### Snapshot staleness
**Definition:** A snapshot is stale when it no longer represents a build run that DevopsMonitor should actively retain for notification diffing.

**Age field that should determine staleness:** the associated monitored build run's **completion time (`finishTime`)**. If a supporting freshness signal is needed for a build that already appears terminal but has a missing or unreliable `finishTime`, use the **last successful poll/refresh time**.

**Why:** Snapshots are subordinate cache for the monitored run. They should remain available as long as the product still intends to watch that run, then age out 12 hours after the run is actually finished.

### Monitored build staleness
**Definition:** A monitored build entry is stale when the **specific monitored build run** has been in a terminal/completed state for more than 12 hours.

**Age field that should determine staleness:** the monitored build run's **completion time (`finishTime`)**.

**Why not monitoring start, build start, or only `last_polled_at`?**
- Monitoring start was rejected because it can silently end monitoring before a long-lived approval-needed event occurs.
- Build start is not the point at which monitoring value necessarily ends.
- `last_polled_at` is only a supporting fallback signal for already-terminal builds; it is not the primary product clock.

### 12 hours old
For product purposes, "12 hours old" should mean:
- **Monitored build entries:** more than 12 hours since the monitored build run completed.
- **Snapshots:** more than 12 hours since the associated monitored build run completed, or cleanup-eligible immediately once that monitored build is pruned.
- **Dismissed build entries:** more than 12 hours since the dismissal/monitoring decision was recorded for that build run.

## Product Rules and Edge Cases

1. **Active and approval-pending builds are never pruned while still active.**
   - If a monitored build is still running, still pending approval, or otherwise not yet terminal, cleanup must not remove the monitored build or its snapshot no matter how much wall-clock time has elapsed.
   - Rationale: approval gates can sit idle overnight or over weekends; pruning before completion would drop some of the highest-value notifications the product is meant to deliver.

2. **Snapshots should not be pruned ahead of a still-retained monitored item in a way that resets notification history.**
   - If the monitored build run is still retained, its current snapshot must also be retained.
   - Rationale: deleting the snapshot first can cause duplicate completion/approval notifications on the next poll.

3. **Old monitored runs should age out even if the UI still lists them.**
   - Because the product monitors a specific build run, not a durable subscription, old runs should not remain indefinitely in the "Monitored builds" list.

4. **There is no current pin/favorite exemption in the product.**
   - Current code exposes Start Monitoring, Stop Monitoring, and Dismissed-state flows only.
   - Therefore no protected "keep forever" state exists today.

5. **Transient poll/build-fetch failures should not by themselves prove staleness.**
   - A cleanup decision should not assume "missing this poll" means "safe to delete."

## Acceptance Criteria

### Functional behavior
- DevopsMonitor defines stale-data cleanup against the current monitoring identity: **one specific build run** identified by `{ org, project, pipelineId, buildId }`.
- DevopsMonitor also applies the same retention policy to `dismissed_builds` entries for the same monitored identity.
- Once a monitored build run becomes stale, the product removes:
  - its monitored-build record from the monitored-items list,
  - its associated snapshot used for diffing that same monitored identity.
- Once a dismissed build entry becomes stale, the product removes that dismissed entry.
- A snapshot with no matching retained monitored-build record is considered cleanup-eligible and must not remain indefinitely.
- Cleanup preserves non-stale monitored items, non-stale dismissed entries, and the snapshots needed by retained monitored items.

### Trigger-independent expectations
- The product evaluates stale persisted monitoring data on normal extension lifecycle opportunities; the exact technical trigger is implementation-defined.
- After a cleanup opportunity occurs, stale entries are gone before they can continue presenting as active monitoring state.
- Cleanup must be safe to run repeatedly without deleting additional non-stale items or corrupting retained state.

### What must be retained
- A monitored build run that has **not** yet crossed the product's stale threshold must remain visible and monitored.
- A monitored build run that is still actively progressing or awaiting approval must remain visible and monitored even if more than 12 hours have elapsed since monitoring began.
- A dismissed build entry that has **not** yet crossed the product's stale threshold must remain dismissed.
- The current snapshot for any retained monitored build run must remain retained.

### What must not happen
- Cleanup must not delete a retained monitored item's only current snapshot and thereby cause duplicate notifications on the next poll.
- Cleanup must not remove a monitored item solely because a fetch or poll attempt failed transiently.
- Cleanup must not prune an in-progress or approval-pending monitored build solely because 12 or more hours have elapsed since monitoring started.
- Cleanup must not make the popup or options page render a just-deleted item as still monitored after the same cleanup pass.
- Cleanup must not make the popup or options page render a just-deleted dismissed entry as still suppressed after the same cleanup pass.
- Cleanup must not silently reinterpret an old monitored build as a different newer build.
- Cleanup must not broaden scope from "specific build run" to "entire pipeline definition."

### Observability
- Cleanup is housekeeping and should be **non-intrusive** for end users.
- No desktop notification, badge alert, or blocking prompt is required just because cleanup happened.
- The user may observe cleanup indirectly because old monitored entries, stale snapshots, and expired dismissed entries no longer appear in the popup/options storage views.
- Lightweight troubleshooting visibility is acceptable (for example, developer-oriented logging), but user-facing noise is not required.
- User-facing copy for the monitored list should say **"Monitored builds"**, not **"Monitored pipelines"**.

## Risks and Assumptions
- Assumes the approved product model remains "monitor one specific build run," not "follow a pipeline forever."
- Assumes deleting a snapshot while retaining its monitored item is product-risky because snapshot loss resets change-detection history.
- Assumes completion-anchored retention better matches the product promise for long-lived approval workflows.
- The current persisted models do **not** store explicit per-entry freshness timestamps, so the eventual implementation may need additional metadata to satisfy this product definition exactly.

## Open Questions
1. **Resolved:** The 12-hour limit for monitored builds and snapshots begins at build completion (`finishTime`), not at monitoring start.
2. **Resolved:** If a build already appears terminal but `finishTime` is missing or unreliable, use last successful poll time as the fallback age reference.
3. **Resolved:** Approval-pending and otherwise active builds are protected and must not be pruned while still in that state.
4. **Resolved:** `dismissed_builds` are in scope and expire 12 hours after dismissal.
5. **Resolved:** No manual "Clean now" action; automatic cleanup only for now.
6. **Resolved:** UI copy should say **"Monitored builds"**.

Remaining open questions:
- None at the product-spec level right now.

## Out of Scope
- Technical implementation details, storage schema design, alarms/scheduling APIs, or execution order.
- Changes to polling cadence.
- Redesigning the monitoring model into true pipeline-following behavior.
- Cleanup rules for credentials or notification history.
- User-configurable retention windows or a manual cleanup control.
