# Project Context

- **Owner:** Max Buining
- **Project:** Azure DevOps Deployment Notifier — Chrome/Edge browser extension
- **Stack:** TypeScript, Jest, jest-chrome, Webpack
- **Created:** 2026-08-26

## Learnings

📌 2026-08-26: No tests written yet — test suite setup is MVP Task 10 (end-to-end integration test). Priority areas when tests are written: poller state change detection, URL parser (parseAdoBuildUrl), storage helpers, AdoClient error handling.

📌 2026-08-26: Chrome extension APIs (chrome.storage, chrome.alarms, chrome.notifications, chrome.tabs) need jest-chrome mock setup before any unit tests can run.

📌 Team update (2026-08-28T13:34:01.027+02:00): Re-validated the final production-blocker scope with npm test PASS (27/27) and approved the release scope after the pinned-build failure fix.

📌 Team update (2026-09-15T09:00:50+02:00): For stale-data cleanup, acceptance tests had to move off a local reference model and onto the real `src/background/state.ts` exports; spec-complete coverage is only trustworthy when it exercises shipped code paths and assets.

📌 Team update (2026-09-15T15:08:38+02:00): Acceptance-criteria validation stays trustworthy through refactors when tests exercise the real shipped code and scenario docs are updated to match deliberate policy changes (like drop-on-expire for legacy dismissed records).
