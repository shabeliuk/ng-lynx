import { bootstrapLynxApplication } from 'ng-lynx';

import './app.css';
import { AppComponent } from './app.component.js';

bootstrapLynxApplication(AppComponent).catch((err) => {
  console.error('[ng-lynx] bootstrap failed', err);
});
