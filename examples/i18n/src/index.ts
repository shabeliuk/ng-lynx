// Installs `globalThis.$localize` — required so untranslated (source-locale)
// builds can evaluate `$localize` tagged templates at runtime. Its own
// runtime footprint is plain string concatenation (see docs/35-i18n.md) —
// safe on PrimJS, no polyfill needed. Translated (locale-inlined) builds
// don't need this at all, since the inliner replaces every `$localize` call
// with a plain string before the bundle ships — but importing it
// unconditionally keeps one entry point working for both cases.
import '@angular/localize/init';

import { bootstrapLynxApplication } from 'angular-lynx';

import './app.css';
import { AppComponent } from './app.component.js';

bootstrapLynxApplication(AppComponent).catch((err) => {
  console.error('[angular-lynx] bootstrap failed', err);
});
