# Monitoring Toggle Visual Spec

### Problem Statement
The product currently requires users to open the extension popup to start monitoring a stage, even when they are already looking at the relevant Azure DevOps pipeline run on the Stages tab. That creates avoidable friction: the user has to leave the page context, use the popup flow, and manually confirm monitoring state instead of seeing and controlling it directly where the stage information already lives.

### User Story
As a user viewing a pipeline run's Stages tab on the Azure DevOps website, I want a one-click monitor button and an on-page visual indicator for each stage, so that I can start monitoring from the page I'm already using and immediately see whether a stage is already being monitored.

### Acceptance Criteria
- The feature applies to the **Azure DevOps pipeline run page itself**, specifically the **Stages** tab, not to the extension popup as the primary interaction surface.
- The extension injects on-page UI into supported `https://dev.azure.com/*` pipeline-run pages so the monitoring control appears while the user is viewing the Azure DevOps Stages tab.
- On the Stages tab, each eligible stage row/card shows:
  - a visible **Monitor** action when that stage is not currently monitored for the active build, and
  - a visible **Monitored** state indicator when that stage is currently monitored.
- The injected monitoring state is obvious in-page without requiring the user to open the extension popup to verify whether a stage is already watched.
- Clicking the injected control for an unmonitored stage starts monitoring that stage with a single click from the page itself.
- The one-click flow must not require the user to open the popup or go through a separate stage-picker dialog for the clicked stage.
- If the clicked stage is already monitored for the active build, the injected UI reflects that state and provides a clear way to stop/toggle off monitoring for that exact stage.
- Starting monitoring persists the stage using the existing monitored-items storage model under **`pipeline_configs`**, tied to the current monitoring identity (`org`, `project`, `pipelineId`, `buildId`) plus the selected stage entry.
- The on-page monitored/not-monitored state is derived from the persisted saved state in **`pipeline_configs`**, not from temporary DOM state alone.
- The monitored state is determined by exact build/stage identity, not by stage label alone across other builds or other pipelines.
- Toggling monitoring on the page updates the persisted monitored-items list so subsequent background polls include or exclude that stage accordingly.
- The background polling model remains unchanged: the poller still reads persisted monitored items and still runs on the existing **`chrome.alarms`** cadence; this feature only changes how monitored stages are added/removed.
- Any corresponding snapshot state continues to use the existing snapshot model under **`build_snapshots`**, and toggling off a stage must not leave the injected UI or popup claiming it is still monitored after its saved config is removed or updated.
- The existing dismissed-build behavior under **`dismissed_builds`** remains distinct from active monitoring; a dismissed build must not be shown on-page as actively monitored unless the persisted monitoring config actually includes that build/stage.
- If monitoring state changes elsewhere while the page is open (for example from the popup or another Azure DevOps tab), the injected stage visuals update to reflect the latest saved `pipeline_configs` state rather than remaining stale.
- The injected UI remains present or is re-applied when Azure DevOps re-renders the Stages tab content during client-side navigation or React-driven DOM updates.
- When the active page is outside the configured org, not a supported pipeline-run Stages view, or lacks enough build/stage context to map the DOM to a monitoring identity, the extension does not inject misleading monitored-state UI.
- The popup may continue to display monitored items, but the primary acceptance requirement for this feature is the on-page Azure DevOps Stages-tab experience.

### Risks and Assumptions
- Assumes the corrected scope is direct Azure DevOps page injection on the pipeline-run Stages tab, replacing the earlier popup-first interpretation.
- Assumes the existing persisted monitoring identity (`org`, `project`, `pipelineId`, `buildId`) remains the source of truth for whether an item is being monitored.
- Assumes the current repo has **host permissions** for `https://dev.azure.com/*`, but it does **not** yet define manifest `content_scripts` or other visible content-script infrastructure in `src/`, so this feature likely introduces new on-page injection plumbing rather than extending an existing injected UI.
- Injecting UI into a third-party Azure DevOps page is fragile: DOM structure, CSS class names, ARIA labels, or client-side routing behavior may change without notice and break selectors or placement.
- Azure DevOps appears to be a dynamic React-style application, so reliable stage-button injection may require re-scan/re-attach behavior such as a `MutationObserver` or equivalent lifecycle handling when the page re-renders.
- The exact visual treatment (button label, badge, chip, icon, highlight, or inline state text) is a future design/detail decision as long as the monitored vs not-monitored states are explicit and discoverable on-page.
- Out of scope for this feature: injecting controls on Azure DevOps pages other than the pipeline-run Stages tab, repo-level or PR-level monitoring, redesigning the underlying monitoring identity model, changing polling intervals, adding bulk-monitor actions, or introducing non-ADO site injection.
