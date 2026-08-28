# Work Routing

How to decide who handles what.

## Routing Table

| Work Type | Route To | Examples |
|-----------|----------|----------|
| Requirements, user stories, acceptance criteria, spec-kit docs | Reuben | New feature intake, problem statement, "what should this do?" |
| Technical design, risk ID, simplicity/complexity tradeoffs, task breakdown | Rusty | API design, manifest structure, technical design from an approved spec |
| Manifest V3, service worker, background polling, Chrome APIs | Linus | Background script, alarms API, storage API, ADO REST integration |
| Popup UI, options page, notifications, badge styling | Saul | HTML/CSS popup, options form, badge counter, notification templates |
| Architecture review, code review, security/permissions review | Basher | Reviewing Rusty's design, reviewing Linus/Saul diffs, manifest permissions, token handling |
| Test scenarios, edge cases, acceptance criteria validation | Livingston | Jest tests, mock ADO responses, edge case coverage, validating a feature against Reuben's acceptance criteria |
| Logging, memory, decision merging | Scribe | Always background, never blocks |
| RAI review, content safety, credential checks | Rai | Background by default, blocks on 🔴 findings |
| Claim verification, devil's advocate | Fact Checker | Pre-ship review, verify API docs claims |

## Spec Driven Development Flow

For any feature work, the sequence is: **Reuben (spec) → Rusty (design) → [user review/approval] → Basher (design review, optional pre-implementation) → Linus/Saul (implementation) → Basher (code review) → Livingston (test + acceptance criteria validation)**. Do not skip Reuben/Rusty and jump straight to Linus/Saul from a high-level idea.

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
8. **Role discipline** — Reuben defines what/why (requirements), Rusty defines how (design), Linus/Saul build only what's been designed, Basher reviews before/after implementation, Livingston validates against Reuben's acceptance criteria. Developers do not make product or architecture decisions.
5. **"Team, ..." → fan-out.** Spawn all relevant agents in parallel as `mode: "background"`.
6. **Anticipate downstream work.** If a feature is being built, spawn the tester to write test cases from requirements simultaneously.
7. **Issue-labeled work** — when a `squad:{member}` label is applied to an issue, route to that member. The Lead handles all `squad` (base label) triage.
