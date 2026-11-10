/**
 * Bootstrap for Angular-on-Lynx.
 *
 * `@angular/platform-browser`'s `bootstrapApplication` is unusable here because
 * it pulls in DOM-specific platform providers (a `DomAdapter`, the browser
 * `DOCUMENT`, event-manager plugins, …). Instead we reuse the same private
 * primitive that `bootstrapApplication` is built on — `ɵinternalCreateApplication`
 * — and supply our own providers: zoneless change detection and the Lynx
 * renderer factory. This is the same approach non-DOM platforms such as
 * NativeScript-Angular use.
 *
 * Change detection is **zoneless**: there is no Zone.js. Angular schedules a
 * change-detection pass whenever a signal it depends on changes (or
 * `ChangeDetectorRef.markForCheck()` is called); at the end of each pass our
 * `LynxRendererFactory2.end()` flushes the accumulated ops to the Main Thread.
 */
import {
  APP_ID,
  type ApplicationRef,
  DOCUMENT,
  type EnvironmentProviders,
  ErrorHandler,
  inject,
  type Provider,
  type Type,
  ɵINJECTOR_SCOPE as INJECTOR_SCOPE,
  ɵINTERNAL_APPLICATION_ERROR_HANDLER as INTERNAL_APPLICATION_ERROR_HANDLER,
  ɵinternalCreateApplication as internalCreateApplication,
  provideZonelessChangeDetection,
  RendererFactory2,
} from '@angular/core';

import { LynxErrorHandler } from './error-handler.js';
import { trackApplication } from './page-destroy.js';
import { recordBootstrap } from './reload.js';
import { LynxRendererFactory2 } from './renderer.js';
import { GLOBAL_DOCUMENT } from './shadow-element.js';

/**
 * The base providers every Angular-Lynx app needs:
 *  - zoneless change detection (signals drive updates), and
 *  - the Lynx {@link RendererFactory2}.
 *
 * Compose this into a custom bootstrap, or just call
 * {@link bootstrapLynxApplication} which applies it for you.
 *
 * @public
 */
export function provideLynx(): (Provider | EnvironmentProviders)[] {
  return [
    // Mark the application environment injector as the 'root' scope so that
    // `providedIn: 'root'` core services (PendingTasks, ApplicationInitStatus,
    // …) resolve. The browser platform normally establishes this; a DOM-free
    // bootstrap must do it explicitly.
    { provide: INJECTOR_SCOPE, useValue: 'root' },
    provideZonelessChangeDetection(),
    { provide: RendererFactory2, useClass: LynxRendererFactory2 },
    // Angular core's environment initializer requires an ErrorHandler to exist
    // (normally supplied by the browser platform). LynxErrorHandler forwards to
    // lynx.reportError() (native crash reporting / DevTool) in addition to the
    // default console.error — override this provider for different behavior.
    { provide: ErrorHandler, useClass: LynxErrorHandler },
    // APP_ID is normally supplied by the browser platform; provide one so
    // core's initializers resolve it.
    { provide: APP_ID, useValue: 'angular-lynx' },
    // Angular 22 asks for `DOCUMENT.head` while creating every root component
    // (`getStyleHost`) and throws NG0210 without one. Lynx has no document, so
    // this is the sentinel the renderer already uses for `(window:x)` targets.
    { provide: DOCUMENT, useValue: GLOBAL_DOCUMENT },
    // The application bootstrap reads INTERNAL_APPLICATION_ERROR_HANDLER, which
    // the browser platform normally provides. Supply a minimal one that routes
    // uncaught errors to the configured ErrorHandler.
    {
      provide: INTERNAL_APPLICATION_ERROR_HANDLER,
      useFactory: () => {
        const errorHandler = inject(ErrorHandler);
        return (error: unknown) => errorHandler.handleError(error);
      },
    },
  ];
}

/**
 * Options accepted by {@link bootstrapLynxApplication}.
 * @public
 */
export interface BootstrapLynxOptions {
  /** Application-level providers (router, HTTP, your services, …). */
  providers?: (Provider | EnvironmentProviders)[];
}

/**
 * Bootstrap a standalone Angular root component onto the Lynx page root.
 *
 * Unlike the web, there is no host-selector lookup: Lynx has a single page root
 * (created on the Main Thread by `__CreatePage`) and the root component always
 * mounts there. The renderer's `selectRootElement` resolves to that root
 * regardless of the component's selector.
 *
 * @example
 * ```ts
 * // src/index.ts
 * import { bootstrapLynxApplication } from 'angular-lynx';
 * import { AppComponent } from './app.component';
 *
 * bootstrapLynxApplication(AppComponent);
 * ```
 *
 * @param rootComponent - A standalone Angular component.
 * @param options - Optional application providers.
 * @returns A promise resolving to the {@link ApplicationRef}.
 * @public
 */
export function bootstrapLynxApplication(
  rootComponent: Type<unknown>,
  options: BootstrapLynxOptions = {},
): Promise<ApplicationRef> {
  recordBootstrap(() => bootstrapLynxApplication(rootComponent, options));
  return internalCreateApplication({
    rootComponent,
    appProviders: [...provideLynx(), ...(options.providers ?? [])],
  }).then((app) => {
    trackApplication(app);
    return app;
  });
}
