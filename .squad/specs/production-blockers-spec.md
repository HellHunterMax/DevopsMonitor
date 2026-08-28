# Production Blockers Spec

## Blocker 1: XSS risk in popup

### Problem Statement
The popup currently displays Azure DevOps-derived and tab-derived values inside a privileged extension UI without a guaranteed safe rendering contract. That creates an extension-context XSS risk, which could expose sensitive data and undermine trust in the extension.

### User Story
As a user, I want pipeline and build details to render safely in the popup, so that monitored data can never execute content or expose my saved credentials.

### Acceptance Criteria
- All popup-visible values derived from Azure DevOps responses or the active tab are treated as untrusted input.
- If a pipeline, project, stage, branch, or related label contains HTML-like or script-like characters, the popup shows the literal text instead of interpreting it as markup.
- No popup state allows rendered remote data to trigger script or event-handler execution in the extension UI.
- The popup remains functional and readable when untrusted values contain special characters, long names, or mixed formatting characters.
- The security requirement applies consistently across every popup state that displays external data, not just the default monitored state.

### Risks and Assumptions
- Assumes Azure DevOps names and URL-derived labels may contain arbitrary user-controlled characters.
- Tightening the rendering contract may slightly change visual formatting in the popup.
- This spec covers safe presentation of external values in the popup; broader secret-storage hardening is outside this blocker.

## Blocker 2: Zero automated test infrastructure

### Problem Statement
The extension has no runnable automated test command and no existing test coverage for core monitoring behavior. That makes regressions in critical logic too easy to ship undetected.

### User Story
As a maintainer, I want a runnable automated test suite for the extension's critical logic, so that production-impacting regressions are caught before release.

### Acceptance Criteria
- The repository provides a single documented automated test command exposed through `package.json`.
- Running the test command from the repository root executes successfully on a standard contributor setup.
- Automated tests exist for the core behaviors of poller, state, popup, URL parsing/building, and storage logic.
- Test coverage includes both happy paths and critical edge/failure paths for each of those areas.
- The suite verifies notification/state behavior strongly enough to catch duplicate, missed, or mis-scoped monitoring regressions.
- The suite becomes part of the release-readiness baseline for future production claims.

### Risks and Assumptions
- Assumes the current code can be exercised through tests without changing product scope.
- Adding reliable tests may require refactoring seams around browser APIs, storage, or network dependencies.
- Initial test work may surface additional defects that were previously hidden by the absence of coverage.

## Blocker 3: Monitoring identity / scope confusion

### Problem Statement
The product currently has an unclear monitoring identity boundary and an unclear credential scope boundary. Users can be shown monitoring state for the wrong unit of work, and the saved PAT can be reused against an active-tab org that is not the configured org.

### User Story
As a user, I want monitoring state and credential use to stay bound to the intended Azure DevOps scope, so that the popup reflects the right item and my PAT is never reused outside the configured org.

### Acceptance Criteria
- The product spec defines a single source of truth for what is being monitored: a pipeline, a specific build run, or another explicitly named unit.
- Popup states, persisted monitoring records, and background monitoring behavior all use that same monitoring identity consistently.
- Monitoring records distinguish scope well enough to avoid false matches across different orgs, projects, pipelines, or runs.
- The popup does not show an item as already monitored unless it matches the defined monitoring identity exactly.
- Authenticated popup actions are allowed only when the active tab belongs to the same configured Azure DevOps org identity.
- When the active tab is outside the configured org scope, the popup gives a clear non-destructive message and does not reuse the saved PAT for that tab context.
- Opening non-ADO pages or different-org ADO pages does not change saved monitoring scope or trigger cross-scope credential use.

### Risks and Assumptions
- Assumes the immediate production scope is a single configured Azure DevOps org unless multi-org support is explicitly added later.
- Clarifying monitoring identity may require migration or reset behavior for previously saved monitored items.
- Reducing scope ambiguity may remove some convenience behavior, but correctness and credential containment take priority for production readiness.
