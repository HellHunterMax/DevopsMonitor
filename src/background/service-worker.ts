import { runPoll } from './poller';
import { handleNotificationClick } from './notifier';

const ALARM_NAME = 'devops-poll';

function registerAlarm(): void {
  chrome.alarms.get(ALARM_NAME, existing => {
    if (!existing) {
      chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });
    }
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.clear(ALARM_NAME, () => {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });
  });
  runPoll().catch(console.error);
});
chrome.runtime.onStartup.addListener(registerAlarm);

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) {
    runPoll().catch(console.error);
  }
});

chrome.notifications.onClicked.addListener(notificationId => {
  handleNotificationClick(notificationId).catch(console.error);
});
