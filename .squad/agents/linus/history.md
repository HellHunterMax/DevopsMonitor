# Project Context

- **Owner:** Max Buining
- **Project:** Azure DevOps Deployment Notifier — Chrome/Edge browser extension
- **Stack:** TypeScript, Manifest V3, Chrome Extension APIs, Azure DevOps Build REST API, Webpack
- **Created:** 2026-08-26

## Learnings

📌 2026-08-26: Scaffolded full extension skeleton — manifest, service worker, popup, options, API stubs, webpack config.

📌 2026-08-26: Critical lesson — manifest `"type": "module"` breaks webpack IIFE output. Chrome rejects the service worker entirely. Never add `"type": "module"` to the background declaration.

📌 2026-08-26: Switched from Classic Release API (vsrm.dev.azure.com) to YAML Build pipeline API (dev.azure.com). Timeline endpoint gives stage list with type === 'Stage' filter.

📌 2026-08-26: Removed manual project/pipeline picker entirely. Extension detects ADO build page URL via chrome.tabs.query — parses org, project, buildId from URL. Uses PAT from stored credentials with orgUrl from tab URL (avoids stored URL mismatch).

📌 2026-08-26: build.buildNumber in ADO YAML pipelines is the pipeline name format (e.g. "Adapter.Msf"), not a numeric ID. Always use build.id (numeric) when showing "Build #N" to the user.

📌 2026-08-26: Popup has three context-aware states: A (monitoring active), B (dismissed), C (stage picker). dismissed_builds stored as number[] in chrome.storage.local.

📌 Team update (2026-08-28T13:34:01.027+02:00): Fixed the pinned-build failure drift so the poller preserves monitored identity and skips the cycle instead of substituting another build.

📌 Team update (2026-09-01T09:16:00+02:00): Authored the first approval-notification false-positive fix by removing the timeline-only fallback and introducing next-up pending-stage attribution; Basher rejected the revision for same-order parallel-stage ordering, which locked Linus out from revising that artifact further.

📌 Team update (2026-09-04T14:48:51.712+02:00): Removed pre-1.0 storage-schema migration/back-compat code, deleted the poller's malformed-config/latest-build fallback path, and removed the unused getBuilds API helper after confirming the repo no longer needs legacy compatibility.

📌 Team update (2026-09-15T09:00:50+02:00): The stale-data cleanup implementation established a reusable MV3 pattern: route popup/options mutations through the service worker as the single writer, use canonical four-field monitoring keys everywhere, and let lifecycle-aware prune decisions run in the same serialized state boundary.

📌 Team update (2026-09-15T15:08:38+02:00): When feature work exposes an unrelated real bug, extract it into its own documented, tested change instead of bundling it into the feature diff; the stale-data simplification plus standalone owner-id fix was the better pattern.
