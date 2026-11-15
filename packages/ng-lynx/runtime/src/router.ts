/**
 * `ng-lynx/router` — Angular Router integration for Lynx.
 *
 * `provideRouter()` assumes the browser platform in two unconditional places,
 * both eager (resolved as soon as the `Router` is constructed, not lazily):
 *
 *   1. `LocationStrategy` (`PathLocationStrategy` by default) is built on
 *      `PlatformLocation`, which `providedIn: 'platform'`-defaults to
 *      `BrowserPlatformLocation` — `window.history` / `window.location`. Lynx's
 *      Background Thread has neither.
 *   2. `TitleStrategy` (`DefaultTitleStrategy` by default) constructor-injects
 *      `Title` from `@angular/platform-browser`, whose constructor
 *      constructor-injects `DOCUMENT` — a bare reference to the global
 *      `document`, which doesn't exist off the browser platform either.
 *
 * This is the same seam vue-router fills with `createMemoryHistory()` for
 * vue-lynx: navigation state lives in a plain in-memory array, no DOM. Angular
 * doesn't ship a production memory location out of the box (only a
 * testing-only `MockPlatformLocation` in `@angular/common/testing`), so
 * {@link LynxPlatformLocation} below is that primitive, written for Lynx.
 *
 * Everything else `provideRouter()` touches (`Router`, `RouterOutlet`,
 * `ActivatedRoute`, guards, resolvers, `ViewContainerRef.createComponent`, …) is
 * platform-agnostic — confirmed by reading `@angular/router`'s source: the only
 * other `@angular/platform-browser` import in its core chunk is the `Title`
 * token above, and the only other unguarded `DOCUMENT` read
 * (`createViewTransition`) is behind the opt-in `withViewTransitions()`
 * feature, never called by the base providers.
 */
import {
  type EnvironmentProviders,
  inject,
  Injectable,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
} from '@angular/core';
import {
  Location,
  type LocationChangeListener,
  PlatformLocation,
} from '@angular/common';
import {
  provideRouter,
  type Route,
  type RouterFeatures,
  TitleStrategy,
} from '@angular/router';

import { LynxGlobalEvents } from './app-events.js';

interface UrlState {
  pathname: string;
  search: string;
  hash: string;
  state: unknown;
}

/** Split an absolute path (`/a/b?x=1#y`) into its `Location`-relevant parts. */
function parseUrl(url: string): { pathname: string; search: string; hash: string } {
  const hashIndex = url.indexOf('#');
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
  const withoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const searchIndex = withoutHash.indexOf('?');
  const search = searchIndex >= 0 ? withoutHash.slice(searchIndex) : '';
  const pathname = searchIndex >= 0 ? withoutHash.slice(0, searchIndex) : withoutHash;
  return { pathname: pathname || '/', search, hash };
}

/**
 * A DOM-free `PlatformLocation`: navigation state is a plain in-memory stack,
 * not `window.history`. Angular's `PathLocationStrategy` (the Router's default
 * `LocationStrategy`) is built entirely on this abstraction, so providing this
 * instead of the default `BrowserPlatformLocation` is all `provideLynxRouter`
 * needs to make routing work with no DOM.
 *
 * Modeled on `@angular/common/testing`'s `MockPlatformLocation` (same
 * in-memory-stack shape), but written as a real runtime primitive rather than a
 * test double, and without that class's optional start-URL config.
 *
 * @public
 */
@Injectable()
export class LynxPlatformLocation implements PlatformLocation {
  private index = 0;
  private readonly stack: UrlState[] = [{ pathname: '/', search: '', hash: '', state: null }];
  private readonly popStateListeners = new Set<LocationChangeListener>();
  private readonly hashListeners = new Set<LocationChangeListener>();

  private get current(): UrlState {
    return this.stack[this.index];
  }

  getBaseHrefFromDOM(): string {
    return '';
  }

  onPopState(fn: LocationChangeListener): VoidFunction {
    this.popStateListeners.add(fn);
    return () => this.popStateListeners.delete(fn);
  }

  onHashChange(fn: LocationChangeListener): VoidFunction {
    this.hashListeners.add(fn);
    return () => this.hashListeners.delete(fn);
  }

  get href(): string {
    return `${this.current.pathname}${this.current.search}${this.current.hash}`;
  }
  get protocol(): string {
    return 'lynx:';
  }
  get hostname(): string {
    return '';
  }
  get port(): string {
    return '';
  }
  get pathname(): string {
    return this.current.pathname;
  }
  get search(): string {
    return this.current.search;
  }
  get hash(): string {
    return this.current.hash;
  }

  replaceState(state: unknown, _title: string, url: string): void {
    this.stack[this.index] = { ...parseUrl(url), state };
  }

  pushState(state: unknown, _title: string, url: string): void {
    if (this.index < this.stack.length - 1) this.stack.length = this.index + 1;
    this.stack.push({ ...parseUrl(url), state });
    this.index = this.stack.length - 1;
  }

  forward(): void {
    this.historyGo(1);
  }

  back(): void {
    this.historyGo(-1);
  }

  historyGo(relativePosition = 0): void {
    const oldHash = this.current.hash;
    const next = this.index + relativePosition;
    if (next < 0 || next >= this.stack.length) return;
    this.index = next;
    const event = { type: 'popstate', state: this.current.state };
    for (const fn of [...this.popStateListeners]) fn(event);
    if (oldHash !== this.current.hash) {
      for (const fn of [...this.hashListeners]) fn({ type: 'hashchange', state: null });
    }
  }

  getState(): unknown {
    return this.current.state;
  }

  /**
   * Seed the initial (pre-navigation) location — used by
   * `provideLynxRouter`'s `initialUrl` option to reflect the entry URL the
   * host delivered (e.g. via init data), instead of always starting at `/`.
   * Called synchronously inside the `PlatformLocation` factory, before the
   * instance is ever handed to a consumer (the Router included) — so there's
   * no ordering race with the Router's own initial-navigation read of the
   * current location.
   *
   * @internal
   */
  seedInitialUrl(url: string): void {
    this.stack[0] = { ...parseUrl(url), state: null };
  }
}

/**
 * `TitleStrategy` that skips `document.title` entirely (Lynx has no browser
 * tab/window chrome). Avoids `DefaultTitleStrategy`'s constructor-injected
 * `Title` (`@angular/platform-browser`), which constructor-injects `DOCUMENT` —
 * a bare read of the global `document` that doesn't exist on Lynx's Background
 * Thread. A route's `title` property is simply inert under this strategy.
 */
@Injectable()
class NoopTitleStrategy extends TitleStrategy {
  override updateTitle(): void {
    // No-op: Lynx has no document title to set.
  }
}

/**
 * Options specific to {@link provideLynxRouter} — deep-link entry and the
 * hardware/gesture back button, on top of everything `provideRouter()` takes
 * via `features`.
 * @public
 */
export interface LynxRouterOptions {
  /**
   * The initial URL to seed the in-memory location with, instead of always
   * starting at `/`. A real card typically receives its entry URL/query from
   * the native host via **init data** — pass a function reading it from
   * there:
   *
   * ```ts
   * import { lynxInitData } from 'ng-lynx';
   *
   * provideLynxRouter(routes, {
   *   initialUrl: () => lynxInitData<{ url?: string }>()().url,
   * })
   * ```
   *
   * There's no fixed Lynx-wide convention for which init-data key carries the
   * URL — it depends on your host integration, hence the function form rather
   * than a hardcoded key name. A literal string also works (useful in tests).
   * Ignored (falsy return / no return) means the default `/`.
   */
  initialUrl?: string | (() => string | undefined);
  /**
   * Name of the `GlobalEventEmitter` event your host dispatches for the
   * hardware/gesture back button (common on Android). When set, ng-lynx
   * listens for it (via `LynxGlobalEvents`) and calls `Location.back()`.
   *
   * There's no single Lynx-wide event name for this — it's defined by how
   * your native host integration is built (what it emits when the OS back
   * button fires) — so there's no default; pass whatever name your host
   * uses. If the in-memory history is already at its root, `Location.back()`
   * is a no-op (`LynxPlatformLocation` bounds-checks); check `Location.path()`
   * yourself afterward if you need to fall through to letting the host close
   * the card.
   */
  backButtonEvent?: string;
}

/**
 * Angular Router for Lynx. Wraps `provideRouter()` with the two overrides Lynx
 * needs in place of the (DOM-only) defaults — see the module doc above for why
 * — plus optional deep-link entry and back-button wiring (`options`).
 * Everything else (route config, guards, resolvers, `RouterOutlet`, lazy
 * loading, …) works exactly as it does in `@angular/router`'s own docs.
 *
 * `<router-outlet>` renders as a real host element, same as any nested Angular
 * component — see docs/14-content-projection.md. There's no `<a>`/`click` event
 * on Lynx, so `RouterLink`'s host-click binding won't fire; navigate
 * imperatively instead — inject `Router` and call `router.navigateByUrl(...)` /
 * `router.navigate([...])` from a `(tap)` handler.
 *
 * @example
 * ```ts
 * bootstrapLynxApplication(AppComponent, {
 *   providers: [
 *     provideLynxRouter(routes, {
 *       initialUrl: () => lynxInitData<{ url?: string }>()().url,
 *       backButtonEvent: 'onBackPressed', // whatever your host emits
 *     }),
 *   ],
 * });
 * ```
 * @public
 */
export function provideLynxRouter(
  routes: Route[],
  options: LynxRouterOptions = {},
  ...features: RouterFeatures[]
): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: PlatformLocation,
      useFactory: (): LynxPlatformLocation => {
        const location = new LynxPlatformLocation();
        const initialUrl =
          typeof options.initialUrl === 'function' ? options.initialUrl() : options.initialUrl;
        if (initialUrl) location.seedInitialUrl(initialUrl);
        return location;
      },
    },
    { provide: TitleStrategy, useClass: NoopTitleStrategy },
    provideRouter(routes, ...features),
    provideEnvironmentInitializer(() => {
      if (!options.backButtonEvent) return;
      const events = inject(LynxGlobalEvents);
      const location = inject(Location);
      events.listen(options.backButtonEvent, () => location.back());
    }),
  ]);
}
