/**
 * Runs the app's teardown when the page goes away.
 *
 * When a LynxView is destroyed (the user leaves the page, or Android recreates
 * the activity on rotation), the engine calls the JS core's
 * `callDestroyLifetimeFun`, which calls `tt.callDestroyLifetimeFun`. Then it stops
 * every timer and frees the runtime, so this is the last code that runs and nothing
 * asynchronous after it ever will. ReactLynx hooks the same call.
 *
 * Without this hook the JS core threw `(null) is not a function` (LynxError 20100)
 * on every page exit, and `ngOnDestroy` and `DestroyRef` callbacks never ran.
 */
import type { ApplicationRef } from '@angular/core';

import { stopFlushing } from './flush.js';

const apps = new Set<ApplicationRef>();

/** Called by `bootstrapLynxApplication`. */
export function trackApplication(app: ApplicationRef): void {
  apps.add(app);
  app.onDestroy(() => apps.delete(app));
}

/** Installed as `tt.callDestroyLifetimeFun` by entry-background.ts. */
export function destroyApplications(): void {
  // The native tree is already being torn down, so the elements Angular removes
  // below have nowhere to go.
  stopFlushing();
  for (const app of [...apps]) {
    try {
      if (!app.destroyed) app.destroy();
    } catch (err) {
      // An exception here would surface as a LynxError with no app left to handle it.
      console.error('[angular-lynx] error while destroying the application', err);
    }
  }
}
