# Project Context

- **Owner:** Max Buining
- **Project:** Azure DevOps Deployment Notifier — Chrome/Edge browser extension for YAML pipeline stage monitoring
- **Stack:** TypeScript, Manifest V3, Chrome Extension APIs, Azure DevOps Build REST API
- **Universe:** Ocean's Eleven
- **Created:** 2026-08-26

## Learnings

📌 Team update (2026-08-26T09:05:58+02:00): MVP scope defined — Classic Release pipelines dropped in favour of YAML Build pipelines. Context-aware popup detects ADO build pages automatically. Stage-level notification preferences stored per pipeline.

📌 Team update (2026-08-26T10:11:48+02:00): Switched to YAML multi-stage pipeline API. Projects cached with 1-hour TTL. Per-pipeline, per-stage StageConfig stored in pipeline_configs.

📌 Team update (2026-08-26T11:00:22+02:00): PLAN.md updated with Phase 3 post-MVP ideas: auto-show popup setting and in-page Monitor button via content script.

📌 Team update (2026-08-26T12:13:03+02:00): Critical bug fixed — manifest had "type": "module" causing service worker to never load. Removed. Polling and notifications now functional.

📌 Team update (2026-08-28T13:34:01.027+02:00): Production-readiness review ended approved-for-scope after exact monitoring identity, popup XSS hardening, and supporting tests were in place.

📌 Team update (2026-09-01T09:16:00+02:00): Took revision ownership after Linus was locked out, fixed next-up approval attribution to respect same-order parallel stages, and was then locked out too when Basher found a remaining mixed named + stage-less approval bug.

📌 Team update (2026-09-15T09:00:50+02:00): The stale-data cleanup TTL debate reinforced that retention anchors must be tied to the product promise: a simple monitoring-start hard cap looked cheaper, but Fact Checker showed it would break approval-notification trust, so the final design reverted to completion-anchored expiry with active/approval-pending exemptions.

📌 Team update (2026-09-15T15:08:38+02:00): The over-engineering audit reinforced that architectural safety fixes should be scoped to the minimum feature boundary unless the team explicitly chooses a broader refactor.
