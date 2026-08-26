# Squad Decisions

## Active Decisions

### 2026-08-26T09:05:58+02:00: MVP scope defined

**By:** Rusty  
**What:** MVP targets Classic Release pipelines only with PAT auth, single deployment monitoring, and four notification events (approval pending, succeeded, failed, manual validation). The popup includes an in-extension pipeline picker (org → project → definition) so the user never pastes a URL — the extension fetches pipeline lists via the ADO API and constructs all deep-link URLs internally. Content script injection deferred to Phase 2.  
**Why:** Classic Release API is well-documented and directly maps to the approval/deployment events in the README. The in-popup picker is essential UX — requiring users to paste ADO URLs manually is friction that kills adoption. Keeping MVP to one pipeline type and one deployment at a time minimises scope and gets Max something testable fast.

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
