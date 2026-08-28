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
