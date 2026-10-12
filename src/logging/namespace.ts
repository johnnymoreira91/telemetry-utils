import { AsyncLocalStorage } from 'node:async_hooks';

interface RequestStore {
  requestId?: any;
  keyId?: any;
}

export class Namespace {
  private static storage = new AsyncLocalStorage<RequestStore>();

  isActived(): boolean {
    return !!Namespace.storage.getStore();
  }

  private getStore() {
    return Namespace.storage.getStore();
  }

  setRequestId<T>(value: T) {
    const store = this.getStore();
    if (store) {
      store.requestId = value;
    }
  }

  getRequestId<T>(): T | null {
    const store = this.getStore();
    return store?.requestId ?? null;
  }

  setkeyId<T>(value: T) {
    const store = this.getStore();
    if (store && value) {
      store.keyId = value;
    }
  }

  getkeyId<T>(): T | undefined {
    return this.getStore()?.keyId;
  }

  run(fn: () => void) {
    Namespace.storage.run({}, fn);
  }
}

export default new Namespace();
