import { bootstrapLynxApplication } from 'angular-lynx';

// A `.scss` side-effect import — pluginSass() compiles it to CSS, then the
// Lynx stylesheet compiler takes over. Same import shape as a plain `.css`.
import './styles.scss';
import { AppComponent } from './app.component.js';

bootstrapLynxApplication(AppComponent).catch((err) => {
  console.error('[angular-lynx] bootstrap failed', err);
});
