import { bootstrapLynxApplication } from 'angular-lynx';

import './nested-app.css';
import { NestedAppComponent } from './nested-app.component.js';

bootstrapLynxApplication(NestedAppComponent).catch((err) => {
  console.error('[angular-lynx] nested bootstrap failed', err);
});
