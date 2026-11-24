// First, so its clock starts before Angular evaluates.
import { boot } from './boot-clock.js';

import { bootstrapLynxApplication, whenFlushed } from 'ng-lynx';
import { provideLynxHttpClient } from 'ng-lynx/http';
import { provideLynxRouter } from 'ng-lynx/router';

import './app.css';
import { AppComponent } from './app.component.js';
import { routes } from './routes.js';

bootstrapLynxApplication(AppComponent, {
  providers: [provideLynxRouter(routes), provideLynxHttpClient()],
})
  .then(() => {
    boot.ready = Date.now();
    // The first batch, applied on the Main Thread.
    return whenFlushed().then(() => {
      boot.firstFrame = Date.now();
    });
  })
  .catch((err) => {
    console.error('[ng-lynx] bootstrap failed', err);
  });
