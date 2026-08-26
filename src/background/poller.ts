import { getPipelineConfigs } from '../utils/storage';
import { createClient } from '../api/ado-client';
import { getBuilds, getTimeline } from '../api/pipelines';
import { getPendingApprovals } from '../api/approvals';
import { getSnapshot, saveSnapshot } from './state';
import { sendNotification } from './notifier';
import type { BuildSnapshot, StageSnapshot } from '../types/ado';

export async function runPoll(): Promise<void> {
  const client = await createClient();
  if (!client) return;

  const configs = await getPipelineConfigs();
  if (configs.length === 0) return;

  for (const config of configs) {
    try {
      const builds = await getBuilds(client, config.project, config.pipelineId, 1);
      if (builds.length === 0) continue;

      const build = builds[0];
      const snapshot = await getSnapshot(config.pipelineId);

      // Fetch timeline and approvals in parallel
      const [records, approvals] = await Promise.all([
        getTimeline(client, config.project, build.id),
        getPendingApprovals(client, config.project),
      ]);

      const stages = records.filter(r => r.type === 'Stage');
      const newStages: Record<string, StageSnapshot> = {};

      for (const stage of stages) {
        const stageConfig = config.stages.find(
          s => s.stageName.toLowerCase() === stage.name.toLowerCase()
        );
        if (!stageConfig) continue;

        const approvalPending = approvals.some(
          a =>
            a.pipeline.id === config.pipelineId &&
            a.stage.name.toLowerCase() === stage.name.toLowerCase() &&
            a.status === 'pending'
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
            const icon = stage.result === 'succeeded' ? 'OK' : stage.result === 'failed' ? 'FAIL' : 'WARN';
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
        pipelineId: config.pipelineId,
        buildId: build.id,
        stages: newStages,
      };
      await saveSnapshot(newSnapshot);
    } catch (err) {
      console.error(`[DevOps Notifier] Poll failed for pipeline ${config.pipelineId}:`, err);
    }
  }
}
