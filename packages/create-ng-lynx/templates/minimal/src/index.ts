import { bootstrapLynxApplication } from 'ng-lynx';

import './app.css';
import { AppComponent } from './app.component.js';

// Mounts AppComponent onto the Lynx page root. No host selector, no Zone.js —
// signals drive change detection; the renderer ships ops to the Main Thread.
bootstrapLynxApplication(AppComponent).catch((err) => {
  console.error('[ng-lynx] bootstrap failed', err);
});
