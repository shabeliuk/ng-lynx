import { bootstrapLynxApplication } from 'ng-lynx';
import { provideLynxRouter } from 'ng-lynx/router';

import './app.css';
import { AppComponent } from './app.component.js';
import { routes } from './routes.js';

bootstrapLynxApplication(AppComponent, {
  providers: [provideLynxRouter(routes)],
}).catch((err) => {
  console.error('[ng-lynx] bootstrap failed', err);
});
