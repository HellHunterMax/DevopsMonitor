# Production Blockers Design

Approved input: `.squad/specs/production-blockers-spec.md`  
Technical context: `.squad/decisions.md` production-readiness review entries dated 2026-08-28.

## Design goals

1. Fix the popup trust boundary without adding a templating library.
2. Add the smallest useful automated test baseline and make `npm test` real.
3. Make monitoring identity and PAT scope explicit, consistent, and single-org by design.

Complexity check: no new runtime dependencies for rendering, no browser E2E framework yet, no multi-org support yet. Those would add ceremony without solving the approved blockers better.

---

## Blocker 1 — Popup XSS safety

### Decision

Use DOM construction (`createElement`, `textContent`, `replaceChildren`, `append`) for every popup render path that currently mixes markup with Azure DevOps data or active-tab data. Do **not** add a sanitizer library and do **not** keep `innerHTML` plus escaping helpers in the popup; the safer rule is “untrusted popup content never goes through HTML parsing.”

### Exact `popup.ts` render paths to change

Change these functions in `src/popup/popup.ts`:

1. `renderMonitoredList(...)`
   - empty-state render path (`container.innerHTML = ...`)
   - monitored item render path (`item.innerHTML = ...`)
2. `renderStateA(...)`
   - header render path (`header.innerHTML = ...`)
   - body render path (`body.innerHTML = ...`)
3. `renderStateB(...)`
   - header render path (`header.innerHTML = ...`)
   - body render path (`body.innerHTML = ...`)
4. `renderStateC(...)`
   - header render path (`header.innerHTML = ...`)
   - body starter render path (`body.innerHTML = ...`)

`setStatus(...)` is already safe because it uses `textContent`.

### Concrete approach

- Add a tiny local DOM helper or two if it reduces repetition, for example:
  - `clear(el)`
  - `textEl(tag, className, text)`
- Rebuild each section with explicit elements:
  - titles, branch labels, build labels, and watched stage labels via `textContent`
  - `strong` styling via a real `<strong>` node, not string markup
  - buttons created with `document.createElement('button')`
- Use literal Unicode characters directly (`✅`, `🚫`, `·`) instead of HTML entities.
- Prefer `replaceChildren(...)` over `innerHTML = ''` + append.

### Scope note

This blocker is popup-only. The options page already escapes interpolated values, so it is not part of this change set unless the implementation team wants to align style later.

### Why this is the right level of complexity

- A sanitizer/helper layer is unnecessary because the popup only needs simple labels, lists, and buttons.
- DOM APIs are enough and remove the entire HTML-interpretation class of bug.
- A rule of “no `innerHTML` in `popup.ts`” is easier to review than “some `innerHTML` is safe.”

### Implementation tasks

#### Saul
1. Refactor `renderMonitoredList`, `renderStateA`, `renderStateB`, and `renderStateC` to DOM-only rendering.
2. Preserve existing layout/classes so CSS does not need a redesign.
3. Add popup tests proving `<script>`, `<img onerror>`, angle brackets, quotes, and long names render as literal text.

#### Linus
1. Review callback/data wiring after the DOM refactor to ensure stop/start/remove flows still persist the same state transitions.

Dependency order: Saul refactor first, then tests.

---

## Blocker 2 — Automated test infrastructure

### Decision

Adopt **Jest** with **ts-jest** and **jsdom**.

Jest is the simplest fit here:
- Livingston already pointed toward it.
- `package.json` does **not** currently include Jest as a devDependency.
- The codebase is TypeScript-heavy and popup/options tests need a DOM.

### Recommended packages

Add dev dependencies:

- `jest`
- `ts-jest`
- `@types/jest`
- `jest-environment-jsdom`
- `jest-chrome`

No Playwright/Cypress/browser-E2E yet. That is extra cost before a basic regression net exists.

### Recommended config

Add:

- `jest.config.cjs`
- `test/setup/jest.setup.ts`

Recommended baseline config:

- `preset: 'ts-jest'`
- `testEnvironment: 'jsdom'`
- `setupFilesAfterEnv: ['<rootDir>/test/setup/jest.setup.ts']`
- `clearMocks: true`
- `restoreMocks: true`

Use `jsdom` globally to keep the first test harness simple; the background/storage modules do not need a separate environment yet.

### Mocking approach

#### `chrome.*` APIs

Use `jest-chrome` as the base global mock.

In `test/setup/jest.setup.ts`:
- assign `global.chrome = chrome`
- reset mock state before each test
- fill in the extension-specific APIs used here:
  - `chrome.storage.local.get/set/remove`
  - `chrome.tabs.query`
  - `chrome.runtime.sendMessage`
  - `chrome.runtime.openOptionsPage`

Keep storage behavior in-memory inside tests so modules can exercise realistic read/modify/write flows.

#### `fetch`

Mock `global.fetch` directly with `jest.fn()`.

Recommended pattern:
- small response factory for `{ ok, status, statusText, json }`
- per-test explicit payloads for builds, timeline records, approvals, and failures

Do **not** add MSW for this first pass. It is unnecessary for unit-level module coverage.

### `package.json` test script

Set the canonical script to:

```json
"test": "jest --runInBand"
```

Why `--runInBand`:
- simpler shared `chrome` mock state
- fewer race conditions while the suite is small
- enough performance for this repository size

`npm test` becomes the single documented command.

### First test files to create

Create these first, in this order:

1. `src/utils/url-builder.test.ts`
   - valid ADO build URL
   - non-ADO URL
   - missing/invalid `buildId`
   - encoded org/project names
2. `src/utils/storage.test.ts`
   - credentials read/write
   - pipeline configs read/write
   - snapshots read/write
   - dismiss/undismiss behavior
   - missing-key defaults
   - rejected `chrome.storage.local` calls
3. `src/background/state.test.ts`
   - save/update/get/clear snapshot behavior
   - exact-key behavior after identity fix
4. `src/background/poller.test.ts`
   - pinned-build happy path
   - pinned-build fetch failure then latest-build fallback
   - approval detection with and without `stage.name`
   - timeline fallback when approvals API returns `[]`
   - no duplicate completion/approval notifications across unchanged polls
   - snapshot persistence and `lastPolledAt` update
5. `src/popup/popup.test.ts`
   - monitored/dismissed/picker state rendering
   - same-org PAT gating message
   - monitored-item remove flow
   - literal rendering of hostile strings

### Why this is the right level of complexity

- Jest + ts-jest is enough to cover popup, storage, poller, and API seams without changing the build toolchain.
- Adding browser E2E now would slow delivery without first fixing the core logic net.
- Manual QA still matters, but production claims should start from `npm test`.

### Implementation tasks

#### Linus
1. Add Jest dependencies, config, setup file, and `package.json` test script.
2. Build shared mocks for `chrome.storage`, `chrome.runtime`, `chrome.tabs`, and `fetch`.
3. Implement `url-builder`, `storage`, `state`, and `poller` tests.

#### Saul
1. Add `popup.test.ts` using jsdom fixtures after the popup render refactor lands.
2. Cover UI states and hostile-string rendering.

Dependency order:
1. Linus adds harness/config.
2. Saul lands popup DOM-safe refactor.
3. Linus adds logic/storage tests.
4. Saul adds popup tests.
5. Linus finishes poller tests against the stabilized state model.

---

## Blocker 3 — Monitoring identity and PAT scope

### Decision

The monitored unit is **one specific Azure DevOps build run inside one configured Azure DevOps org**.

The identity tuple is:

```ts
{
  org: string;
  project: string;
  pipelineId: number; // pipeline definition id
  buildId: number;    // specific monitored run
}
```

### Why this model

- The current product behavior is already “monitor this build,” not “follow the pipeline forever.”
- `pipelineId` alone is too broad and causes false “Monitoring active” matches.
- `buildId` alone is too weak because it is not enough scope across org/project/pipeline contexts.
- The tuple stays simple and matches the approved spec’s correctness requirement.

True pipeline-following behavior is a different feature and should not be smuggled into this blocker.

### Data-model changes

#### `PipelineConfig`

Keep the type, but change its identity semantics:

- `org` remains required, but it must be the **normalized configured org slug**
- `project` remains required
- `pipelineId` remains required
- rename `lastBuildId` to **`buildId`** and treat it as the monitored-run id, not a mutable “last seen” cursor
- `pipelineName` and `stages` remain descriptive fields, not identity fields

Effective key for create/update/remove/find:

`org + project + pipelineId + buildId`

#### `BuildSnapshot`

Snapshots must carry the same scope:

```ts
{
  org: string;
  project: string;
  pipelineId: number;
  buildId: number;
  stages: Record<string, StageSnapshot>;
}
```

`src/background/state.ts` should stop taking just `pipelineId`. Its helpers should take either:
- the full composite key, or
- a small `MonitoringKey` object

Recommendation: add a shared `MonitoringKey` type and pass that through `popup.ts`, `poller.ts`, `state.ts`, and storage helpers.

#### `dismissed_builds`

Even though the approved blocker called out `PipelineConfig` and snapshots, dismissed-state must also be scoped or the model is still wrong.

Replace raw `number[]` build ids with the same composite identity (or a serialized equivalent). A naked build id is not enough across org/project/pipeline boundaries.

### Popup matching rules

`src/popup/popup.ts` should treat “already monitored” as an **exact monitored-unit match**:

- same configured org
- same project
- same pipeline definition id
- same build run id

This changes State A semantics from “some config exists for this pipeline/project” to “this exact build is being monitored.”

State B (dismissed) must also use the exact monitored-unit key, not only `buildId`.

### Poller behavior

The poller should continue monitoring only the exact configured build run.

- If `buildId` exists, fetch that run and stay pinned to it.
- Latest-build fallback should be treated as legacy/backward-compat only during migration, not steady-state semantics.
- Snapshots are written/read by exact monitored-unit key.

### PAT scope and org validation

The PAT is valid only for the configured org identity.

#### Required popup flow

1. Load saved credentials.
2. Normalize saved `orgUrl` into a canonical form:
   - `https`
   - hostname `dev.azure.com`
   - exactly one org path segment
   - no query/hash
   - no trailing slash significance
3. Read the active tab and parse build-page context.
4. If the active tab is **not** an ADO build page, do nothing special; keep the general monitored list behavior.
5. If the active tab is an ADO build page but its normalized org does **not** match the configured org:
   - do **not** construct `AdoClient`
   - do **not** call `fetch`
   - do **not** reuse the PAT
   - show a clear non-destructive message in the popup, for example:
     - “This page belongs to org X, but DevopsMonitor is configured for org Y. Switch to the configured org or update Options.”
6. Only when the orgs match may the popup fetch build/timeline data and offer monitoring actions.

### Migration / compatibility

Keep this simple.

Because this work happens before a real production release, a heavy migration framework is not justified. The minimum acceptable plan is:

1. add a single storage schema version key
2. best-effort map legacy `lastBuildId -> buildId`
3. re-scope snapshots if possible
4. clear legacy dismissed-build entries if they cannot be scoped safely

If migration code starts dominating the change, stop and choose reset-over-complexity.

### Why this is the right level of complexity

- Single-org support matches the approved spec and current product assumptions.
- The exact monitored-unit tuple fixes the real false-match bug without inventing multi-org account management.
- Renaming `lastBuildId` to `buildId` removes a misleading concept from the model.

### Implementation tasks

#### Linus
1. Add a shared `MonitoringKey`/normalized-org model to types and storage helpers.
2. Update `PipelineConfig` semantics to exact build-run identity (`buildId`, not `lastBuildId`).
3. Update snapshot storage/state helpers to use the composite key.
4. Re-scope dismissed-state storage to the same key.
5. Update `poller.ts` to read/write exact-key snapshots and keep pinned-build behavior explicit.
6. Add one-time schema migration/reset handling, keeping it minimal.

#### Saul
1. Update popup matching so State A and State B use exact monitored-unit identity.
2. Add the org-mismatch popup state/message and block authenticated actions on mismatch.
3. Ensure the popup still shows the existing monitored list when the active tab is non-ADO or wrong-org.

Dependency order:
1. Linus defines key/model changes.
2. Saul updates popup matching and org-gating against the new model.
3. Linus finalizes migration and poller wiring.
4. Tests cover the new identity rules.

---

## Recommended delivery order

1. **Identity model first** — it changes matching and state semantics.
2. **Popup DOM safety second** — once popup paths are stable, UI tests become straightforward.
3. **Test harness and tests throughout** — harness first, then storage/identity tests, then popup tests, then poller regression coverage.

This keeps the design simple: define the right key, make the popup safe, then lock behavior down with tests.
