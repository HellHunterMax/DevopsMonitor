# Squad Decisions

## Active Decisions

### 2026-09-01: Review of approval-needed false-positive fix
**By:** Basher
**What:** Rejected the current `src/background/poller.ts` / `poller.test.ts` approval-fix diff for one blocking correctness issue. `getNextUpPendingStageName()` treats every earlier item in the sorted array as a predecessor, so same-order parallel stages can block each other based on incidental timeline record order.
**Why:** The intended heuristic is "first pending stage whose predecessors are completed/skipped." Stages with the same `order` are peers, not predecessors. With the current `slice(0, i)` check, a parallel pending stage at the same `order` can suppress or misattribute a stage-less approval notification. Tests cover the sequential cases but do not cover equal-order parallel stages (or skipped-predecessor tie cases), so this regression path is currently unguarded.

### 2026-09-01: Re-review of approval-needed false-positive fix
**By:** Basher
**What:** Rejected the revised diff again for one remaining blocking correctness issue. The new same-order grouping fix is good, but mixed approval payloads are still over-broadly attributed.
**Why:** When `buildApprovals` contains both stage-specific and stage-less approvals, `hasStageInfo` becomes true and the code uses `buildApprovals.some(a => !a.stage?.name || a.stage.name.toLowerCase() === stage.name.toLowerCase())`. That means any single stage-less approval makes **every** watched stage look approval-pending, instead of mapping stage-less approvals through the computed next-up stage set. This can reintroduce false positives. The new tests correctly cover same-order parallel stages and skipped predecessors, but they still do not cover this mixed-payload case.

### 2026-09-01: Final review of approval-needed false-positive fix
**By:** Basher
**What:** Approved the latest `src/background/poller.ts` / `poller.test.ts` revision.
**Why:** The remaining mixed-payload bug is fixed: named approvals now require exact `stage.name` matches, while stage-less approvals are independently constrained through `getNextUpPendingStageNames()`. The helper correctly treats only strictly lower-order groups as predecessors and allows parallel same-order pending stages to qualify together. Coverage is now adequate for the changed logic: no-approval false-positive regression, earlier-stage-in-progress, sequential next-up mapping, same-order parallel stages, skipped predecessors, and the mixed named+stage-less payload scenario. Removing the old timeline fallback is an acceptable correctness tradeoff; the limitation is clearly documented in code comments, though user-facing capability guidance still remains outside this diff.

### 2026-09-01: Approval detection now requires approvals API evidence
**By:** Linus
**What:** Removed the blind timeline-only `pending => approval` fallback from `src/background/poller.ts`. When Azure DevOps returns pending approvals for a build without `stage.name`, the poller now attributes that approval only to the single "next up" pending stage in timeline order whose predecessors are already completed/skipped.
**Why:** ADO uses `timeline.state = pending` both for real approval waits and for ordinary not-yet-started downstream stages. The old heuristic produced false "Approval needed" notifications for normal sequential pipelines.

### 2026-09-04: Drop pre-1.0 storage migration compatibility
**By:** Linus
**What:** Removed the extension's one-time storage schema migration and old-shape compatibility paths. Stored pipeline configs now require `buildId`, stored snapshots now require the full monitoring key already on disk, and the poller no longer contains a legacy "latest build" fallback.
**Why:** The project is still `0.1.0`/private, and the remaining migration code only existed to preserve malformed or pre-migration local data. General defensive parsing still stays in place so fresh installs and corrupted `chrome.storage.local` reads are safely narrowed without keeping backward-compat behavior alive.
