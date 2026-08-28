import { buildBuildUrl } from '../utils/url-builder';

interface StoredNotification {
  url: string;
}

async function getNotificationMap(): Promise<Record<string, StoredNotification>> {
  const result = await chrome.storage.local.get('notification_map');
  return (result.notification_map as Record<string, StoredNotification>) ?? {};
}

async function saveNotificationMap(map: Record<string, StoredNotification>): Promise<void> {
  await chrome.storage.local.set({ notification_map: map });
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
  id: string,
  title: string,
  message: string,
  orgUrl: string,
  project: string,
  buildId: number
): Promise<void> {
  const url = buildBuildUrl(orgUrl, project, buildId);
  const map = await getNotificationMap();
  map[id] = { url };
  await saveNotificationMap(map);

  chrome.notifications.create(id, {
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
    chrome.notifications.clear(notificationId);
  }
}
