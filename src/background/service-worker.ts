import { runPoll } from "./poller";
import { runStaleDataPrune } from "./state";
import { handleNotificationClick, sendTestNotification } from "./notifier";

const POLL_ALARM_NAME = "devops-poll";
const PRUNE_ALARM_NAME = "devops-prune";

function registerAlarm(name: string, periodInMinutes: number): void {
	chrome.alarms.get(name, (existing) => {
		if (!existing) {
			chrome.alarms.create(name, { periodInMinutes });
		}
	});
}

function registerAlarms(): void {
	registerAlarm(POLL_ALARM_NAME, 0.5);
	registerAlarm(PRUNE_ALARM_NAME, 60);
}

chrome.runtime.onInstalled.addListener(() => {
	chrome.alarms.clear(POLL_ALARM_NAME, () => {
		chrome.alarms.create(POLL_ALARM_NAME, { periodInMinutes: 0.5 });
	});
	chrome.alarms.clear(PRUNE_ALARM_NAME, () => {
		chrome.alarms.create(PRUNE_ALARM_NAME, { periodInMinutes: 60 });
	});
	void (async () => {
		await runStaleDataPrune();
		await runPoll();
	})().catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
	registerAlarms();
	void runStaleDataPrune().catch(console.error);
});

chrome.alarms.onAlarm.addListener((alarm) => {
	if (alarm.name === POLL_ALARM_NAME) {
		void runPoll().catch(console.error);
	}

	if (alarm.name === PRUNE_ALARM_NAME) {
		void runStaleDataPrune().catch(console.error);
	}
});

chrome.notifications.onClicked.addListener((notificationId) => {
	void handleNotificationClick(notificationId).catch(console.error);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message.type === "TEST_NOTIFICATION") {
		void sendTestNotification()
			.then(() => sendResponse({ ok: true }))
			.catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
		return true;
	}

	if (message.type === "FORCE_POLL") {
		void runPoll()
			.then(() => sendResponse({ ok: true }))
			.catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
		return true;
	}

	return false;
});
