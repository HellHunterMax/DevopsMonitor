# RAI Audit Trail

> Append-only evidence log. Entries are redacted — never contains raw secrets or harmful content.

<!-- Rai appends findings below -->

## 2026-08-28 — Production src review — Verdict: 🟡 Yellow

- `src/popup/popup.ts:38-42,80-82,124-126` — Category: injection / untrusted HTML sink — Severity: yellow — Evidence: ADO/tab-derived strings rendered via `innerHTML` in popup UI — Remediation: open
- `src/api/approvals.ts:10-12`; `src/types/ado.ts:39-40` — Category: privacy / PII logging — Severity: yellow — Evidence: approval payload logging includes approver display-name and identifier fields — Remediation: open
- `src/background/service-worker.ts:9,16,18,24,39`; `src/background/poller.ts:37-39,158`; `src/api/ado-client.ts:14-16` — Category: rate limiting / abuse posture — Severity: yellow — Evidence: fixed 30s polling plus manual trigger, no single-flight lock, no `429`/backoff handling — Remediation: open
- `src/manifest.json:6-8` — Category: permissions review — Severity: green — Evidence: only `storage`, `notifications`, `alarms`, `tabs`, and `https://dev.azure.com/*` host access present — Remediation: none needed
- `src/` credential scan — Category: hardcoded secrets — Severity: green — Evidence: no committed PAT/token/private-key material detected in reviewed source tree — Remediation: none needed
