# Project Context

- **Owner:** Max Buining
- **Project:** Azure DevOps Deployment Notifier — Chrome/Edge browser extension
- **Stack:** HTML, CSS, TypeScript (popup/options UI layer)
- **Created:** 2026-08-26

## Learnings

📌 2026-08-26: Popup is 340px wide. Three context-aware states: A (monitoring active — blue header, stop button), B (dismissed — red "not monitoring" state), C (stage picker — pill toggle buttons).

📌 2026-08-26: Stage pills replaced sub-checkboxes. One click = monitor that stage (success + failure + approval). Cleaner than granular complete/approval toggles.

📌 2026-08-26: "None" checkbox replaced with "Don't monitor this build" button. Cleaner intent — it's a decision, not a selection.

📌 2026-08-26: Primary colour is Azure blue #0078d4. Secondary/destructive action uses #c42b1c with btn-secondary class.

📌 Team update (2026-08-28T13:34:01.027+02:00): Popup production blockers closed with XSS-safe literal rendering and state semantics aligned to exact monitored-build identity.

📌 Team update (2026-09-01T09:16:00+02:00): Took the third revision after Linus and Rusty were locked out, split named-stage approval matching from stage-less approval routing through next-up pending stages, and landed the Basher-approved final fix.

📌 Team update (2026-09-15T09:00:50+02:00): Stale-data cleanup exposed a UI handoff lesson — when a copy change touches shipped markup, verify the real static HTML templates changed on disk and make tests load the runtime template, not only a hand-built fixture.
