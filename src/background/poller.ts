import { createClient } from "../api/ado-client";
import { getPendingApprovals } from "../api/approvals";
import { getBuild, getTimeline } from "../api/pipelines";
import type { AdoApproval, AdoBuild, AdoTimelineRecord, BuildSnapshot, MonitoringKey, StageSnapshot } from "../types/ado";
import { getSnapshot, saveSnapshot } from "./state";
import { sendNotification } from "./notifier";
import { getPipelineConfigs, setLastPolledAt } from "../utils/storage";

function isStageResolved(stage: AdoTimelineRecord): boolean {
	return stage.state === "completed" || stage.result === "skipped";
}

function parseBuildFinishedAt(build: AdoBuild): number | undefined {
	if (!build.finishTime) return undefined;
	const parsed = Date.parse(build.finishTime);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function getApprovalBuildOwnerId(approval: { pipeline?: { owner?: { id?: number | string } } }): number | null {
	const rawOwnerId = approval.pipeline?.owner?.id;
	if (typeof rawOwnerId === "number" && Number.isFinite(rawOwnerId)) {
		return rawOwnerId;
	}

	if (typeof rawOwnerId === "string") {
		const parsedOwnerId = Number(rawOwnerId);
		return Number.isFinite(parsedOwnerId) ? parsedOwnerId : null;
	}

	return null;
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
				if (stage.state === "pending") {
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

			let build: AdoBuild;
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

			const [records, approvals] = await Promise.all([
				getTimeline(client, config.project, build.id),
				getPendingApprovals(client, config.project),
			]);

			const stages = records.filter((record) => record.type === "Stage");
			const newStages: Record<string, StageSnapshot> = {};
			const nextUpPendingStageNames = getNextUpPendingStageNames(stages);
			const buildApprovals = approvals.filter(
				(approval) => getApprovalBuildOwnerId(approval) === build.id && approval.status.toLowerCase() === "pending"
			);

			console.log(
				`[DevOps Notifier] Poll pipeline "${config.pipelineName}" build #${build.id}: ` +
					`${stages.length} stages, ${approvals.length} pending approvals`
			);

			for (const stage of stages) {
				const stageConfig = config.stages.find(
					(configuredStage) => configuredStage.stageName.toLowerCase() === stage.name.toLowerCase()
				);
				if (!stageConfig) continue;

				let approvalPending = false;

				if (buildApprovals.length > 0) {
					const stageName = stage.name.toLowerCase();
					const namedApprovals = buildApprovals.filter((approval) => approval.stage?.name);
					const stagelessApprovals = buildApprovals.filter((approval) => !approval.stage?.name);

					const matchesNamedApproval = namedApprovals.some(
						(approval) => approval.stage!.name.toLowerCase() === stageName
					);
					const matchesStagelessApproval =
						stagelessApprovals.length > 0 && nextUpPendingStageNames.has(stageName);

					approvalPending = matchesNamedApproval || matchesStagelessApproval;
				}

				console.log(
					`[DevOps Notifier] Stage "${stage.name}": state=${stage.state}, result=${stage.result ?? "null"}, approvalPending=${approvalPending}`
				);

				newStages[stage.name] = {
					state: stage.state,
					result: stage.result,
					approvalPending,
				};

				const prevStage = snapshot?.stages?.[stage.name];
				const notifId = `${config.pipelineId}-${build.id}-${stage.name}`;

				if (stageConfig.notifyOnComplete && stage.state === "completed") {
					const prevCompleted = prevStage?.state === "completed" && prevStage?.result === stage.result;
					if (!prevCompleted && stage.result) {
						const icon = stage.result === "succeeded" ? "✅" : stage.result === "failed" ? "❌" : "⚠️";
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

			const snapshotTimestamp = Date.now();
			const newSnapshot: BuildSnapshot = {
				org: snapshotKey.org,
				project: snapshotKey.project,
				pipelineId: snapshotKey.pipelineId,
				buildId: snapshotKey.buildId,
				stages: newStages,
				buildStatus: build.status,
				buildFinishedAt: parseBuildFinishedAt(build),
				lastSuccessfulPollAt: snapshotTimestamp,
			};
			await saveSnapshot(newSnapshot);
		} catch (err) {
			console.error(`[DevOps Notifier] Poll failed for pipeline ${config.pipelineId}:`, err);
		}
	}
	await setLastPolledAt(Date.now());
}
