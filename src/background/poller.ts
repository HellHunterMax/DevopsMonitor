import { getPipelineConfigs, setLastPolledAt } from '../utils/storage';
import { createClient } from '../api/ado-client';
import { getBuild, getTimeline } from '../api/pipelines';
import { getPendingApprovals } from '../api/approvals';
import { getSnapshot, saveSnapshot } from './state';
import { sendNotification } from './notifier';
import type { AdoTimelineRecord, BuildSnapshot, MonitoringKey, StageSnapshot } from '../types/ado';

function isStageResolved(stage: AdoTimelineRecord): boolean {
  return stage.state === 'completed' || stage.result === 'skipped';
}

function getNextUpPendingStageNames(stages: AdoTimelineRecord[]): Set<string> {
  const stagesByOrder = new Map<number, AdoTimelineRecord[]>();

  for (const stage of [...stages].sort((a, b) => a.order - b.order)) {
    const stagesAtOrder = stagesByOrder.get(stage.order);
    if (stagesAtOrder) {
      stagesAtOrder.push(stage);
    } else {
      stagesByOrder.set(stage.order, [stage]);
    }
  }

  const nextUpPendingStageNames = new Set<string>();
  let allLowerOrderStagesResolved = true;

  for (const stagesAtOrder of stagesByOrder.values()) {
    if (allLowerOrderStagesResolved) {
      for (const stage of stagesAtOrder) {
        if (stage.state === 'pending') {
          nextUpPendingStageNames.add(stage.name.toLowerCase());
        }
      }
    }

    if (!stagesAtOrder.every(isStageResolved)) {
      allLowerOrderStagesResolved = false;
    }
  }

  return nextUpPendingStageNames;
}

export async function runPoll(): Promise<void> {
  const client = await createClient();
  if (!client) return;

  const configs = await getPipelineConfigs();
  if (configs.length === 0) return;

  for (const config of configs) {
    try {
      const snapshotKey: MonitoringKey = {
        org: config.org,
        project: config.project,
        pipelineId: config.pipelineId,
        buildId: config.buildId,
      };

      let build: import('../types/ado').AdoBuild;

      try {
        build = await getBuild(client, config.project, config.buildId);
      } catch (err) {
        console.warn(
          `[DevOps Notifier] Pinned build ${config.buildId} fetch failed; skipping poll cycle for pipeline ${config.pipelineId}:`,
          err
        );
        continue;
      }

      const snapshot = await getSnapshot(snapshotKey);

      // Fetch timeline and approvals in parallel
      const [records, approvals] = await Promise.all([
        getTimeline(client, config.project, build.id),
        getPendingApprovals(client, config.project),
      ]);

      const stages = records.filter(r => r.type === 'Stage');
      const newStages: Record<string, StageSnapshot> = {};
      const nextUpPendingStageNames = getNextUpPendingStageNames(stages);

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
        // Approval detection — defensive, evidence-based
        //
        // The ADO _apis/pipelines/approvals response does NOT reliably include a
        // top-level `stage` field, so we first narrow approvals to the current
        // build run via `pipeline.owner.id`.
        //
        // Strategy 1: approvals with `stage.name` must match that exact stage name.
        //
        // Strategy 2: approvals without stage info are always build-level signals,
        // so attribute them only to "next up" pending stages — every pending stage
        // whose strictly lower-order predecessors are already completed/skipped.
        // Parallel same-order stages can all qualify at once.
        //
        // We intentionally do NOT guess from `stage.state === 'pending'` alone when
        // the approvals API returns no matching approvals. In ADO timelines, pending
        // also means "not started yet", so that heuristic produces false positives.
        // ---------------------------------------------------------------------------

        let approvalPending = false;

        // Build-level approvals from the API
        // pipeline.owner.id is the build RUN id; pipeline.id is the definition id (string)
        const buildApprovals = approvals.filter(
          a => a.pipeline.owner.id === build!.id && a.status === 'pending'
        );

        if (buildApprovals.length > 0) {
          const stageName = stage.name.toLowerCase();
          const namedApprovals = buildApprovals.filter(a => a.stage?.name);
          const stagelessApprovals = buildApprovals.filter(a => !a.stage?.name);

          const matchesNamedApproval = namedApprovals.some(
            a => a.stage!.name.toLowerCase() === stageName
          );
          const matchesStagelessApproval =
            stagelessApprovals.length > 0 && nextUpPendingStageNames.has(stageName);

          approvalPending = matchesNamedApproval || matchesStagelessApproval;
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
