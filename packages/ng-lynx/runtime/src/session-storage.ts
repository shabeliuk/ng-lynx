/**
 * `LynxSessionStorage` — a DI-friendly wrapper over Lynx's session storage
 * (`lynx.getSessionStorageItem` / `setSessionStorageItem` /
 * `subscribeSessionStorage` / `unsubscribeSessionStorage`), the mechanism for
 * sharing data **across multiple LynxViews** (e.g. a card and its host page,
 * or two cards in the same session) — distinct from `initData`/`globalProps`
 * (per-card load-time data) and native modules (host-registered bridges).
 *
 * `get`/`subscribe` are callback-based on the real API; wrapped here as a
 * `Promise` and a disposer-returning subscription respectively, matching the
 * rest of this package's DI services (`LynxGlobalEvents`, `LynxIntersectionObserver`).
 */
import { Injectable, type OnDestroy } from '@angular/core';

interface LynxSessionStorageApi {
  getSessionStorageItem(key: string, callback: (data: unknown) => void): void;
  setSessionStorageItem(key: string, value: unknown): void;
  subscribeSessionStorage(key: string, callback: (data: unknown) => void): void;
  unsubscribeSessionStorage(key: string, callback: (data: unknown) => void): void;
}

declare const __DEV__: boolean;

// eslint-disable-next-line no-var
declare var lynx: LynxSessionStorageApi | null | undefined;

/**
 * Injectable access to Lynx's cross-LynxView session storage.
 *
 * @example
 * ```ts
 * export class DraftService {
 *   private readonly storage = inject(LynxSessionStorage);
 *
 *   async loadDraft(): Promise<string | undefined> {
 *     return this.storage.get<string>('draft-text');
 *   }
 *   saveDraft(text: string): void {
 *     this.storage.set('draft-text', text);
 *   }
 * }
 * ```
 * @public
 */
@Injectable({ providedIn: 'root' })
export class LynxSessionStorage implements OnDestroy {
  private readonly unsubscribers: (() => void)[] = [];

  /** Read a stored value. Resolves `undefined` if unset or unavailable. */
  get<T = unknown>(key: string): Promise<T | undefined> {
    return new Promise((resolve) => {
      if (typeof lynx === 'undefined' || !lynx?.getSessionStorageItem) {
        if (__DEV__) {
          console.warn(
            '[ng-lynx] LynxSessionStorage.get: lynx.getSessionStorageItem is '
              + 'unavailable in this environment; resolving undefined.',
          );
        }
        resolve(undefined);
        return;
      }
      lynx.getSessionStorageItem(key, (data) => resolve(data as T | undefined));
    });
  }

  /** Write a value, visible to every LynxView sharing this session. */
  set(key: string, value: unknown): void {
    if (typeof lynx === 'undefined' || !lynx?.setSessionStorageItem) {
      if (__DEV__) {
        console.warn(
          '[ng-lynx] LynxSessionStorage.set: lynx.setSessionStorageItem is '
            + 'unavailable in this environment; the write was dropped.',
        );
      }
      return;
    }
    lynx.setSessionStorageItem(key, value);
  }

  /**
   * Subscribe to changes on `key` (including writes from other LynxViews).
   * Returns an unsubscribe function; subscriptions are also removed when the
   * application (root injector) is destroyed.
   */
  subscribe<T = unknown>(key: string, callback: (value: T) => void): () => void {
    if (typeof lynx === 'undefined' || !lynx?.subscribeSessionStorage) {
      if (__DEV__) {
        console.warn(
          '[ng-lynx] LynxSessionStorage.subscribe: lynx.subscribeSessionStorage '
            + `is unavailable in this environment; the "${key}" subscription will not fire.`,
        );
      }
      return () => {};
    }
    const handler = (data: unknown): void => callback(data as T);
    lynx.subscribeSessionStorage(key, handler);
    let removed = false;
    const unsubscribe = (): void => {
      if (removed) return;
      removed = true;
      lynx?.unsubscribeSessionStorage?.(key, handler);
    };
    this.unsubscribers.push(unsubscribe);
    return unsubscribe;
  }

  ngOnDestroy(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
  }
}
