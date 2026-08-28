# Azure DevOps Pipeline Monitor — Project Plan

**Lead:** Rusty  
**Updated:** 2026-08-26  
**Status:** Active — Phase 1 complete, Phase 2 in progress

---

## Current State (as built)

The extension monitors **YAML/Build pipelines** via a **context-aware popup** that detects the current tab's pipeline context from the Azure DevOps URL.

---

## Architecture

### Manifest V3 Components

| Component | Status | Role |
|---|---|---|
| Background Service Worker | ✅ Built | Owns the polling loop, state tracking, and notification dispatch via `chrome.alarms` |
| Popup | ✅ Built | Context-aware UI — shows build-specific states on ADO build pages, pipeline list elsewhere |
| Options Page | ✅ Built | One-time setup: ADO org URL, PAT token, "Test Connection" |
| Content Script | 🔜 Phase 3 | In-page monitor button injected into ADO build result pages |

### Service Worker Polling

Manifest V3 service workers are not persistent. Polling uses `chrome.alarms` every 30 seconds.

- `chrome.alarms.create('poll', { periodInMinutes: 0.5 })` registered on `onInstalled` and `onStartup`.
- `chrome.alarms.onAlarm` wakes the worker, runs the poll, lets it sleep.
- Never use `setInterval` or `setTimeout` — they die with the service worker.

### Storage

All state lives in **`chrome.storage.local`** (device-local, not synced):

| Key | Contents |
|---|---|
| `ado_pat` | Personal Access Token |
| `ado_org_url` | ADO org URL (e.g. `https://dev.azure.com/myorg`) |
| `pipeline_configs` | Array of `PipelineConfig` — one per monitored build, with `StageConfig[]` |
| `build_snapshots` | Last-known stage statuses per buildId, used for change detection |
| `dismissed_builds` | Set of buildIds the user explicitly chose not to monitor |
| `last_polled_at` | Timestamp of the most recent completed poll cycle |

---

## Azure DevOps REST API

Base URL: `https://dev.azure.com/{org}/{project}`  
Auth: `Authorization: Basic base64(:{PAT})`  
Required PAT scopes: **Build (read)**, **Environments (read)**

### Implemented Endpoints

| Purpose | Endpoint |
|---|---|
| Fetch a single build | `GET /_apis/build/builds/{buildId}` |
| Fetch latest build for a pipeline | `GET /_apis/build/builds?definitions={id}&$top=1` |
| Fetch build timeline (stages + status) | `GET /_apis/build/builds/{buildId}/timeline` |
| Fetch pending approvals | `GET /_apis/pipelines/approvals?state=pending` *(fails silently if unavailable)* |

---

## Context-Aware Popup

The popup detects the active tab URL via `chrome.tabs.query` and switches between two modes.

### On a build results page (`/_build/results?buildId={id}`)

Parses org, project, and buildId from the URL, then fetches the build and timeline. Shows one of three states:

| State | Condition | UI |
|---|---|---|
| **C — Picker** | Build not yet monitored or dismissed | Stage pills (click to toggle), "Start Monitoring", "Don't monitor this build" |
| **A — Active** | Build is being monitored | ✅ Monitoring active, watched stages listed, "Stop Monitoring" |
| **B — Dismissed** | User clicked "Don't monitor this build" | 🚫 Not monitoring this build, "Monitor this build" |

Dismissed buildIds are stored in `dismissed_builds` and persist across sessions.

### On any other page

Shows the list of all currently monitored pipelines.

---

## Stage Monitoring

- User selects stages as pill toggles in State C.
- Selecting a stage enables both **completion notifications** (success + failure) and **approval notifications** for that stage.
- Multiple pipelines and multiple stages across pipelines are supported simultaneously.
- Each pipeline stored as a `PipelineConfig` with a `StageConfig[]` array in `pipeline_configs`.

---

## Notifications

| Event | Notification |
|---|---|
| Stage succeeded | `✅ [PipelineName] StageName: succeeded` |
| Stage failed | `❌ [PipelineName] StageName: failed` |
| Stage awaiting approval | `⏳ Approval needed — PipelineName: StageName awaiting approval` |

Click any notification → opens `/_build/results?buildId={id}` in a new tab.

---

## Options Page

- ADO org URL input
- PAT input (required scopes: Build read, Environments read)
- "Test Connection" button

---

## File Structure (as built)

```
src/
├── manifest.json                    # MV3 manifest — SW, popup, options, permissions
├── background/
│   ├── service-worker.ts            # Registers alarms, wires runtime listeners
│   ├── poller.ts                    # Fetches ADO state, detects stage changes, fires notifications
│   ├── notifier.ts                  # Wraps chrome.notifications; builds messages + deep-links
│   └── state.ts                     # Typed read/write of build_snapshots and pipeline_configs
├── popup/
│   ├── popup.html
│   ├── popup.ts                     # Context-aware popup: State A/B/C + pipeline list mode
│   └── popup.css
├── options/
│   ├── options.html
│   ├── options.ts                   # Org URL + PAT form + "Test Connection"
│   └── options.css
├── api/
│   ├── ado-client.ts                # Base HTTP client; attaches PAT auth, handles errors
│   ├── approvals.ts                 # Fetches pending pipeline approvals; degrades gracefully if API is unavailable
│   └── pipelines.ts                 # Fetches builds, individual build details, and build timeline records
├── types/
│   └── ado.ts                       # TypeScript interfaces: Build, TimelineRecord, Approval, PipelineConfig, StageConfig
└── utils/
    ├── storage.ts                   # Typed helpers for chrome.storage.local
    └── url-builder.ts               # Builds ADO deep-links and parses build-page context from ADO URLs
```

**Build tooling (repo root):**
```
package.json
tsconfig.json
webpack.config.js          # Bundles service-worker, popup, and options entry points
dist/                      # Build output — load as unpacked extension in Chrome/Edge
```

---

## Phase Roadmap

### Phase 1 — MVP ✅ Done

- Manifest V3: service worker, popup, options page
- YAML/Build pipeline monitoring
- `chrome.alarms`-based polling every 30 seconds
- Context-aware popup: parses build URL → State A / B / C
- Stage pill selector — user picks which stages to watch
- Dismissed builds remembered per buildId
- Notifications: stage succeeded, stage failed, approval pending
- Click notification → opens build results tab
- Options page: org URL + PAT + "Test Connection"
- Multi-pipeline support

### Phase 2 — Polish & Multi-Pipeline _(planned)_

- **API response caching** — short TTL (30s) on build/timeline responses to reduce API call volume
- **Badge counter** — extension icon badge showing number of actively monitored pipelines
- **Stage status in popup list** — show current stage state (running / succeeded / failed / awaiting) in the monitored pipelines list
- Full validation that multiple stages across multiple pipelines work correctly end-to-end

### Phase 3 — Content Script & Page Integration _(planned)_

Two new ideas from Max:

**Setting: suppress popup auto-show**  
An option in the Options page: *"Show popup automatically when opening a build page"* (toggle, default: off).  
The popup currently never auto-opens — this setting is for a future content script feature. When enabled, a content script would trigger the popup on navigation to a build results page.

**In-page Monitor button (content script)**  
A content script injected into `https://dev.azure.com/*/` pages. On a build results page it injects a small **"Monitor"** button next to each stage in the ADO UI. Clicking a stage's Monitor button:
- Marks that stage as monitored for the current pipeline
- Saves the config to `pipeline_configs` via `chrome.storage.local`
- Shows a brief confirmation toast on the page

This is the most natural UX — no need to open the popup at all.

### Phase 4 — Integrations _(planned)_

- Microsoft Teams webhook notifications
- Slack integration
- Custom notification rules (e.g. only notify on Production stages)
- Deployment history dashboard in the popup
