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
