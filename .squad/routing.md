# Work Routing

How to decide who handles what.

## Routing Table

| Work Type | Route To | Examples |
|-----------|----------|----------|
| Architecture, scope, decisions, code review | Rusty | API design, manifest structure, overall strategy |
| Manifest V3, service worker, background polling, Chrome APIs | Linus | Background script, alarms API, storage API, ADO REST integration |
| Popup UI, options page, notifications, badge styling | Saul | HTML/CSS popup, options form, badge counter, notification templates |
| Unit tests, integration tests, ADO API mocking | Livingston | Jest tests, mock ADO responses, edge case coverage |
| Logging, memory, decision merging | Scribe | Always background, never blocks |
| Backlog monitoring, issue queue | Ralph | When active, scans open issues and drives progress |
| RAI review, content safety, credential checks | Rai | Background by default, blocks on 🔴 findings |
| Claim verification, devil's advocate | Fact Checker | Pre-ship review, verify API docs claims |

## Issue Routing

| Label | Action | Who |
|-------|--------|-----|
| `squad` | Triage: analyze issue, assign `squad:{member}` label | Lead |
| `squad:{name}` | Pick up issue and complete the work | Named member |

### How Issue Assignment Works

1. When a GitHub issue gets the `squad` label, the **Lead** triages it — analyzing content, assigning the right `squad:{member}` label, and commenting with triage notes.
2. When a `squad:{member}` label is applied, that member picks up the issue in their next session.
3. Members can reassign by removing their label and adding another member's label.
4. The `squad` label is the "inbox" — untriaged issues waiting for Lead review.

## Rules

1. **Eager by default** — spawn all agents who could usefully start work, including anticipatory downstream work.
2. **Scribe always runs** after substantial work, always as `mode: "background"`. Never blocks.
3. **Quick facts → coordinator answers directly.** Don't spawn an agent for "what port does the server run on?"
4. **When two agents could handle it**, pick the one whose domain is the primary concern.
5. **"Team, ..." → fan-out.** Spawn all relevant agents in parallel as `mode: "background"`.
6. **Anticipate downstream work.** If a feature is being built, spawn the tester to write test cases from requirements simultaneously.
7. **Issue-labeled work** — when a `squad:{member}` label is applied to an issue, route to that member. The Lead handles all `squad` (base label) triage.
