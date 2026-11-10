/**
 * `LynxErrorHandler` — forwards uncaught Angular errors to `lynx.reportError()`
 * so they reach the host's native crash-reporting / DevTool pipeline instead
 * of only ever being `console.error`'d into a runtime with no visible
 * console on-device.
 *
 * `provideLynx()` installs this as the default `ErrorHandler`; override it
 * yourself (a normal `{ provide: ErrorHandler, useClass: ... }` provider) if
 * an app wants different behavior.
 */
import { ErrorHandler, Injectable } from '@angular/core';

// eslint-disable-next-line no-var
declare var lynx:
  | {
      reportError?(error: string | Error, options?: { level?: 'warning' | 'error' | 'fatal' }): void;
    }
  | null
  | undefined;

/** @public */
@Injectable()
export class LynxErrorHandler extends ErrorHandler {
  override handleError(error: unknown): void {
    // Preserve the default behavior (console.error) so nothing regresses for
    // apps relying on it (headless tests, the web preview's DevTools).
    super.handleError(error);

    if (typeof lynx === 'undefined' || !lynx?.reportError) return;
    const reportable = error instanceof Error ? error : new Error(String(error));
    lynx.reportError(reportable, { level: 'error' });
  }
}
