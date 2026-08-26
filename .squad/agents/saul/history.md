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
