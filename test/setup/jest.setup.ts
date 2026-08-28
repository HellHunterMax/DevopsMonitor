import { chrome as jestChrome } from 'jest-chrome';

type StorageValue = Record<string, unknown>;

let storageState: StorageValue = {};

function clone<T>(value: T): T {
  if (value === undefined) {
    return value;
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function readStorage(
  keys?: string | string[] | StorageValue | null
): StorageValue {
  if (keys == null) {
    return clone(storageState);
  }

  if (typeof keys === 'string') {
    return storageState[keys] === undefined ? {} : { [keys]: clone(storageState[keys]) };
  }

  if (Array.isArray(keys)) {
    return keys.reduce<StorageValue>((acc, key) => {
      if (storageState[key] !== undefined) {
        acc[key] = clone(storageState[key]);
      }
      return acc;
    }, {});
  }

  return Object.entries(keys).reduce<StorageValue>((acc, [key, defaultValue]) => {
    acc[key] = storageState[key] === undefined ? clone(defaultValue) : clone(storageState[key]);
    return acc;
  }, {});
}

function writeStorage(items: StorageValue): void {
  for (const [key, value] of Object.entries(items)) {
    storageState[key] = clone(value);
  }
}

function removeStorage(keys: string | string[]): void {
  const keyList = Array.isArray(keys) ? keys : [keys];
  for (const key of keyList) {
    delete storageState[key];
  }
}

function installChromeMocks(): void {
  (globalThis as { chrome?: unknown }).chrome = jestChrome;

  jestChrome.storage.local.get.mockImplementation(async (keys?: string | string[] | StorageValue | null) => {
    return readStorage(keys);
  });
  jestChrome.storage.local.set.mockImplementation(async (items: StorageValue) => {
    writeStorage(items);
  });
  jestChrome.storage.local.remove.mockImplementation(async (keys: string | string[]) => {
    removeStorage(keys);
  });
  jestChrome.tabs.query.mockResolvedValue([]);
  jestChrome.runtime.sendMessage.mockResolvedValue(undefined);
  jestChrome.runtime.openOptionsPage.mockImplementation(() => undefined as never);
}

beforeEach(() => {
  storageState = {};
  jest.clearAllMocks();
  installChromeMocks();
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: jest.fn(),
  });
});
