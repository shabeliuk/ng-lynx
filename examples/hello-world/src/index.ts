import { bootstrapLynxApplication } from 'ng-lynx';

import './app.css';
import { AppComponent } from './app.component.js';

// Mounts AppComponent onto the Lynx page root. No host selector, no Zone.js —
// the renderer flushes ops to the Main Thread at the end of every CD pass.
bootstrapLynxApplication(AppComponent).catch((err) => {
  console.error('[ng-lynx] bootstrap failed', err);
});
