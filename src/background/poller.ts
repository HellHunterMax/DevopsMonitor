import { getPipelineConfigs, setLastPolledAt } from '../utils/storage';
import { createClient } from '../api/ado-client';
import { getBuilds, getBuild, getTimeline } from '../api/pipelines';
import { getPendingApprovals } from '../api/approvals';
import { getSnapshot, saveSnapshot } from './state';
import { sendNotification } from './notifier';
import type { BuildSnapshot, MonitoringKey, StageSnapshot } from '../types/ado';

export async function runPoll(): Promise<void> {
  const client = await createClient();
  if (!client) return;

  const configs = await getPipelineConfigs();
  if (configs.length === 0) return;

  for (const config of configs) {
    try {
      const pinnedBuildId =
        Number.isInteger(config.buildId) && config.buildId > 0 ? config.buildId : null;
      const baseMonitoringKey = {
        org: config.org,
        project: config.project,
        pipelineId: config.pipelineId,
      };

      let build: import('../types/ado').AdoBuild;
      let snapshotKey: MonitoringKey;

      if (pinnedBuildId !== null) {
        snapshotKey = {
          ...baseMonitoringKey,
          buildId: pinnedBuildId,
        };

        try {
          build = await getBuild(client, config.project, pinnedBuildId);
        } catch (err) {
          console.warn(
            `[DevOps Notifier] Pinned build ${pinnedBuildId} fetch failed; skipping poll cycle for pipeline ${config.pipelineId}:`,
            err
          );
          continue;
        }
      } else {
        // Legacy safety net for malformed pre-migration configs.
        const builds = await getBuilds(client, config.project, config.pipelineId, 1);
        if (builds.length === 0) continue;
        build = builds[0];
        snapshotKey = {
          ...baseMonitoringKey,
          buildId: build.id,
        };
      }

      const snapshot = await getSnapshot(snapshotKey);

      // Fetch timeline and approvals in parallel
      const [records, approvals] = await Promise.all([
        getTimeline(client, config.project, build.id),
        getPendingApprovals(client, config.project),
      ]);

      const stages = records.filter(r => r.type === 'Stage');
      const newStages: Record<string, StageSnapshot> = {};

      console.log(
        `[DevOps Notifier] Poll pipeline "${config.pipelineName}" build #${build.id}: ` +
        `${stages.length} stages, ${approvals.length} pending approvals`
      );

      for (const stage of stages) {
        const stageConfig = config.stages.find(
          s => s.stageName.toLowerCase() === stage.name.toLowerCase()
        );
        if (!stageConfig) continue;

        // ---------------------------------------------------------------------------
        // Approval detection — defensive, multi-strategy
        //
        // The ADO _apis/pipelines/approvals response does NOT reliably include a
        // top-level `stage` field.  The only field we can dependably match on is
        // `pipeline.id`, which is the BUILD (run) id — NOT the pipeline definition id.
        //
        // Strategy 1: match by build-id only (all pending approvals for this run
        // almost certainly block *some* stage the user cares about).
        //
        // Strategy 2 (bonus): if the approval DOES have a `stage.name`, use it for
        // a tighter match; otherwise fall back to build-id match.
        //
        // Strategy 3 (timeline fallback): if the approvals API returns nothing, treat
        // a watched stage that has `state === 'pending'` while the build is still
        // `inProgress` as awaiting approval — this covers ADO environments where the
        // approvals endpoint is gated behind extra permissions.
        // ---------------------------------------------------------------------------

        let approvalPending = false;

        // Build-level approvals from the API
        // pipeline.owner.id is the build RUN id; pipeline.id is the definition id (string)
        const buildApprovals = approvals.filter(
          a => a.pipeline.owner.id === build!.id && a.status === 'pending'
        );

        if (buildApprovals.length > 0) {
          // If any approval has stage info, try a name match first
          const hasStageInfo = buildApprovals.some(a => a.stage?.name);
          if (hasStageInfo) {
            approvalPending = buildApprovals.some(
              a => !a.stage?.name || a.stage.name.toLowerCase() === stage.name.toLowerCase()
            );
          } else {
            // No stage info at all — any pending approval on this build means
            // something is blocked. Only attribute it to stages that are actually
            // waiting (state === 'pending'); a stage that is already 'inProgress'
            // is actively running/deploying, not blocked on approval.
            approvalPending = stage.state === 'pending';
          }
        }

        // Timeline fallback: stage is in "pending" state while build is still running
        if (!approvalPending && build!.status === 'inProgress' && stage.state === 'pending') {
          console.log(
            `[DevOps Notifier] Stage "${stage.name}" has state=pending (timeline fallback) — treating as approval pending`
          );
          approvalPending = true;
        }

        console.log(
          `[DevOps Notifier] Stage "${stage.name}": state=${stage.state}, result=${stage.result ?? 'null'}, approvalPending=${approvalPending}`
        );

        newStages[stage.name] = {
          state: stage.state,
          result: stage.result,
          approvalPending,
        };

        const prevStage = snapshot?.stages?.[stage.name];
        const notifId = `${config.pipelineId}-${build.id}-${stage.name}`;

        // Notify on completion
        if (stageConfig.notifyOnComplete && stage.state === 'completed') {
          const prevCompleted = prevStage?.state === 'completed' && prevStage?.result === stage.result;
          if (!prevCompleted && stage.result) {
            const icon = stage.result === 'succeeded' ? '✅' : stage.result === 'failed' ? '❌' : '⚠️';
            await sendNotification(
              `${notifId}-complete`,
              `${icon} ${config.pipelineName}`,
              `${stage.name}: ${stage.result}`,
              client.orgUrl,
              config.project,
              build.id
            );
          }
        }

        // Notify on approval needed
        if (stageConfig.notifyOnApprovalNeeded && approvalPending && !prevStage?.approvalPending) {
          await sendNotification(
            `${notifId}-approval`,
            `Approval needed - ${config.pipelineName}`,
            `${stage.name} is waiting for your approval`,
            client.orgUrl,
            config.project,
            build.id
          );
        }
      }

      const newSnapshot: BuildSnapshot = {
        org: snapshotKey.org,
        project: snapshotKey.project,
        pipelineId: snapshotKey.pipelineId,
        buildId: snapshotKey.buildId,
        stages: newStages,
      };
      await saveSnapshot(newSnapshot);
    } catch (err) {
      console.error(`[DevOps Notifier] Poll failed for pipeline ${config.pipelineId}:`, err);
    }
  }

  await setLastPolledAt(Date.now());
}
