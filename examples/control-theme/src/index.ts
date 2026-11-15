import { bootstrapLynxApplication } from 'ng-lynx';

// The optional default control theme — styles every ng-lynx/forms control
// from CSS custom properties. Import it FIRST, then app.css overrides tokens.
import 'ng-lynx/forms/theme.css';
import './app.css';
import { AppComponent } from './app.component.js';

bootstrapLynxApplication(AppComponent).catch((err) => {
  console.error('[ng-lynx] bootstrap failed', err);
});
