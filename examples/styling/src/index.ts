import { bootstrapLynxApplication } from 'ng-lynx';

// A `.scss` side-effect import — pluginSass() compiles it to CSS, then the
// Lynx stylesheet compiler takes over. Same import shape as a plain `.css`.
import './styles.scss';
import { AppComponent } from './app.component.js';

bootstrapLynxApplication(AppComponent).catch((err) => {
  console.error('[ng-lynx] bootstrap failed', err);
});
