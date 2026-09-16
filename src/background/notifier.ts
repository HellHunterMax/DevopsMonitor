import { buildBuildUrl } from '../utils/url-builder';

interface StoredNotification {
  url: string;
  logicalId?: string;
}

let notificationSequence = 0;

async function getNotificationMap(): Promise<Record<string, StoredNotification>> {
  const result = await chrome.storage.local.get('notification_map');
  return (result.notification_map as Record<string, StoredNotification>) ?? {};
}

async function saveNotificationMap(map: Record<string, StoredNotification>): Promise<void> {
  await chrome.storage.local.set({ notification_map: map });
}

function createChromeNotificationId(logicalId: string): string {
  return `${logicalId}::${Date.now()}::${notificationSequence++}`;
}

export async function sendTestNotification(): Promise<void> {
  chrome.notifications.create('devops-test-' + Date.now(), {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon48.png'),
    title: '✅ DevOps Notifier',
    message: 'Notifications are working correctly.',
    priority: 2,
  });
}

export async function sendNotification(
  logicalId: string,
  title: string,
  message: string,
  orgUrl: string,
  project: string,
  buildId: number
): Promise<void> {
  const url = buildBuildUrl(orgUrl, project, buildId);
  const notificationId = createChromeNotificationId(logicalId);
  const map = await getNotificationMap();
  map[notificationId] = {
    url,
    logicalId,
  };
  await saveNotificationMap(map);

  chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon48.png'),
    title,
    message,
    priority: 2,
  });
}

export async function handleNotificationClick(notificationId: string): Promise<void> {
  const map = await getNotificationMap();
  const entry = map[notificationId];
  if (entry?.url) {
    await chrome.tabs.create({ url: entry.url });
    delete map[notificationId];
    await saveNotificationMap(map);
    chrome.notifications.clear(notificationId);
  }
}
