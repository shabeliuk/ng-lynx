import { bootstrapLynxApplication } from 'ng-lynx';

import './nested-app.css';
import { NestedAppComponent } from './nested-app.component.js';

bootstrapLynxApplication(NestedAppComponent).catch((err) => {
  console.error('[ng-lynx] nested bootstrap failed', err);
});
