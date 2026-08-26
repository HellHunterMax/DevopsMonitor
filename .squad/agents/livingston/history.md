# Project Context

- **Owner:** Max Buining
- **Project:** Azure DevOps Deployment Notifier — Chrome/Edge browser extension
- **Stack:** TypeScript, Jest, jest-chrome, Webpack
- **Created:** 2026-08-26

## Learnings

📌 2026-08-26: No tests written yet — test suite setup is MVP Task 10 (end-to-end integration test). Priority areas when tests are written: poller state change detection, URL parser (parseAdoBuildUrl), storage helpers, AdoClient error handling.

📌 2026-08-26: Chrome extension APIs (chrome.storage, chrome.alarms, chrome.notifications, chrome.tabs) need jest-chrome mock setup before any unit tests can run.
