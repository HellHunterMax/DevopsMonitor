# Squad Decisions

## Active Decisions

### 2026-08-28T09:53:33+02:00: Retire Ralph (Work Monitor)
**By:** HellHunterMax (via Copilot)
**What:** Removed Ralph (Work Monitor) from the active roster — not actively used for backlog monitoring. Folder moved to `.squad/agents/_alumni/ralph/`, removed from `team.md` roster and `routing.md`, registry status set to `retired` (name reserved, not deleted).
**Why:** User requested removal of unused members; Ralph's backlog-monitoring role is not in active use on this project.

### 2026-08-28T09:43:06+02:00: Formal role split — PM / Architect / Developer / Reviewer / Tester
**By:** HellHunterMax (via Copilot)
**What:** Restructured squad collaboration into 5 explicit roles per user directive:
- **Product Manager (Reuben, new):** defines requirements, writes user stories, creates acceptance criteria, spec-kit expert.
- **Architect (Rusty, re-scoped from Lead):** designs the solution, identifies risks, guards simplicity, challenges unnecessary complexity, adds decisions to the spec-kit. No longer owns code review.
- **Developer (Linus — Extension, Saul — UI, unchanged agents):** implements approved designs only, does not make product or architecture decisions.
- **Reviewer (Basher, new):** reviews architecture, code quality, security and permissions.
- **Tester (Livingston, unchanged agent):** defines test scenarios, looks for edge cases, validates acceptance criteria.

Flow: Reuben (spec) → Rusty (design) → user review → Basher (design/code review) → Linus/Saul (implementation) → Basher (code review) → Livingston (test + acceptance criteria validation).

Updated `.squad/team.md`, `.squad/routing.md`, casting registry/history, and charters for Rusty/Linus/Saul/Livingston; created charters + history for Reuben and Basher.
**Why:** User directive to formalize SDLC-style collaboration roles, complementing the earlier move to Spec Driven Development.

### 2026-08-28T09:35:05+02:00: Adopt Spec Driven Development
**By:** HellHunterMax (via Copilot)
**What:** Before implementing any feature, the team must:
1. Understand the requirement.
2. Create a specification containing: problem statement, user story, acceptance criteria, risks and assumptions.
3. Create a technical design.
4. Break the work into implementation tasks.
5. Wait until the spec and design have been reviewed by the user.
6. Only then generate code.

Agents must never start implementing directly from a high-level idea — a reviewed spec + design is a hard prerequisite for any code generation.
**Why:** Project is moving away from "vibe coding" to a disciplined spec-first workflow, per explicit user directive.

### 2026-08-26T09:05:58+02:00: MVP scope defined

**By:** Rusty  
**What:** MVP targets Classic Release pipelines only with PAT auth, single deployment monitoring, and four notification events (approval pending, succeeded, failed, manual validation). The popup includes an in-extension pipeline picker (org → project → definition) so the user never pastes a URL — the extension fetches pipeline lists via the ADO API and constructs all deep-link URLs internally. Content script injection deferred to Phase 2.  
**Why:** Classic Release API is well-documented and directly maps to the approval/deployment events in the README. The in-popup picker is essential UX — requiring users to paste ADO URLs manually is friction that kills adoption. Keeping MVP to one pipeline type and one deployment at a time minimises scope and gets Max something testable fast.

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
