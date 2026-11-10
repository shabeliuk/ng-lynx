import { bootstrapLynxApplication } from 'angular-lynx';
import { provideLynxRouter } from 'angular-lynx/router';

import './app.css';
import { AppComponent } from './app.component.js';
import { routes } from './routes.js';

bootstrapLynxApplication(AppComponent, {
  providers: [provideLynxRouter(routes)],
}).catch((err) => {
  console.error('[angular-lynx] bootstrap failed', err);
});
