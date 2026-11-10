import { bootstrapLynxApplication } from 'angular-lynx';

import './app.css';
import { AppComponent } from './app.component.js';

bootstrapLynxApplication(AppComponent).catch((err) => {
  console.error('[angular-lynx] bootstrap failed', err);
});
