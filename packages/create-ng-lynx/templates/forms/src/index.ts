import { bootstrapLynxApplication } from 'ng-lynx';

// The controls from ng-lynx/forms ship unstyled. This is their optional default
// theme; app.css comes after it, so its rules and tokens win.
import 'ng-lynx/forms/theme.css';
import './app.css';
import { AppComponent } from './app.component.js';

bootstrapLynxApplication(AppComponent).catch((err) => {
  console.error('[ng-lynx] bootstrap failed', err);
});
