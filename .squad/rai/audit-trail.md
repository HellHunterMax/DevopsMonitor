# RAI Audit Trail

> Append-only evidence log. Entries are redacted — never contains raw secrets or harmful content.

<!-- Rai appends findings below -->

## 2026-08-28 — Production src review — Verdict: 🟡 Yellow

- `src/popup/popup.ts:38-42,80-82,124-126` — Category: injection / untrusted HTML sink — Severity: yellow — Evidence: ADO/tab-derived strings rendered via `innerHTML` in popup UI — Remediation: open
- `src/api/approvals.ts:10-12`; `src/types/ado.ts:39-40` — Category: privacy / PII logging — Severity: yellow — Evidence: approval payload logging includes approver display-name and identifier fields — Remediation: open
- `src/background/service-worker.ts:9,16,18,24,39`; `src/background/poller.ts:37-39,158`; `src/api/ado-client.ts:14-16` — Category: rate limiting / abuse posture — Severity: yellow — Evidence: fixed 30s polling plus manual trigger, no single-flight lock, no `429`/backoff handling — Remediation: open
- `src/manifest.json:6-8` — Category: permissions review — Severity: green — Evidence: only `storage`, `notifications`, `alarms`, `tabs`, and `https://dev.azure.com/*` host access present — Remediation: none needed
- `src/` credential scan — Category: hardcoded secrets — Severity: green — Evidence: no committed PAT/token/private-key material detected in reviewed source tree — Remediation: none needed

## 2026-09-15 — Stale-data cleanup pre-ship pass — Verdict: 🟡 Yellow

- `src\utils\storage.ts:13-17,183-195`; `src\background\state.ts:35,117-154,200-206,249`; `src\background\service-worker.ts:8,34,53-55,61,65,72-73,93-95,169-171` — Category: privacy / automatic deletion scope — Severity: green — Evidence: scheduled prune is limited to `pipeline_configs`, `build_snapshots`, `dismissed_builds`, and `last_polled_at`; credential keys remain isolated as `ado_org_url` and `ado_pat` and are never read/written by prune flow — Remediation: none needed
- `src\background\state.ts:35,117-154`; `src\popup\popup.html:33`; `src\popup\popup.ts:100,178,258`; `src\options\options.html:53-54,71` — Category: transparency / retention notice — Severity: yellow — Evidence: 12h auto-prune removes per-build monitoring records, including old monitored-build entries, but reviewed popup/options copy does not disclose the retention window or that these entries are ephemeral — Remediation: recommend a short user-facing note in popup/options/storage overview clarifying that monitored-build history auto-expires after 12h
- `src\popup\popup.html:33`; `src\options\options.html:71`; `src\popup\popup.ts:100,178,258` — Category: UI language / inclusivity — Severity: green — Evidence: renamed "Monitored builds" wording accurately reflects build-scoped tracking and reviewed strings are neutral, non-deceptive, and non-exclusionary — Remediation: none needed
