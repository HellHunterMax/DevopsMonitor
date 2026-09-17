async function loadNotifierModule() {
  jest.resetModules();
  return import('./notifier');
}

const LOGICAL_ID = '12-77-Prod-complete';
const BUILD_URL = 'https://dev.azure.com/my-org/My%20Project/_build/results?buildId=77';

describe('background notifier', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates a distinct chrome notification id for each emitted alert of the same logical event', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_726_500_000_000);
    const notifier = await loadNotifierModule();

    await notifier.sendNotification(
      LOGICAL_ID,
      '✅ Deploy',
      'Prod: succeeded',
      'https://dev.azure.com/my-org',
      'My Project',
      77
    );
    await notifier.sendNotification(
      LOGICAL_ID,
      '✅ Deploy',
      'Prod: succeeded',
      'https://dev.azure.com/my-org',
      'My Project',
      77
    );

    expect(chrome.notifications.create).toHaveBeenNthCalledWith(
      1,
      `${LOGICAL_ID}::1726500000000::0`,
      expect.objectContaining({
        title: '✅ Deploy',
        message: 'Prod: succeeded',
      })
    );
    expect(chrome.notifications.create).toHaveBeenNthCalledWith(
      2,
      `${LOGICAL_ID}::1726500000000::1`,
      expect.objectContaining({
        title: '✅ Deploy',
        message: 'Prod: succeeded',
      })
    );

    const notificationMap = await chrome.storage.local.get('notification_map');
    expect(notificationMap.notification_map).toEqual({
      [`${LOGICAL_ID}::1726500000000::0`]: {
        url: BUILD_URL,
        logicalId: LOGICAL_ID,
      },
      [`${LOGICAL_ID}::1726500000000::1`]: {
        url: BUILD_URL,
        logicalId: LOGICAL_ID,
      },
    });
  });

  it('removes the clicked emitted notification id only after opening the build url', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_726_500_000_000);
    const notifier = await loadNotifierModule();

    await notifier.sendNotification(
      LOGICAL_ID,
      '✅ Deploy',
      'Prod: succeeded',
      'https://dev.azure.com/my-org',
      'My Project',
      77
    );
    await notifier.handleNotificationClick(`${LOGICAL_ID}::1726500000000::0`);

    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: BUILD_URL });
    expect(
      (chrome.tabs.create as jest.Mock).mock.invocationCallOrder[0]
    ).toBeLessThan(
      (chrome.storage.local.set as jest.Mock).mock.invocationCallOrder[1]
    );
    const notificationMap = await chrome.storage.local.get('notification_map');
    expect(notificationMap.notification_map).toEqual({});
    expect(chrome.notifications.clear).toHaveBeenCalledWith(`${LOGICAL_ID}::1726500000000::0`);
    expect(chrome.notifications.clear).toHaveBeenCalledWith(`${LOGICAL_ID}::1726500000000::0`);
  });

  it('removes the closed emitted notification id without opening a tab or clearing again', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_726_500_000_000);
    const notifier = await loadNotifierModule();

    await notifier.sendNotification(
      LOGICAL_ID,
      '✅ Deploy',
      'Prod: succeeded',
      'https://dev.azure.com/my-org',
      'My Project',
      77
    );
    await notifier.handleNotificationClosed(`${LOGICAL_ID}::1726500000000::0`);

    const notificationMap = await chrome.storage.local.get('notification_map');
    expect(notificationMap.notification_map).toEqual({});
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(chrome.notifications.clear).not.toHaveBeenCalled();
  });
});
