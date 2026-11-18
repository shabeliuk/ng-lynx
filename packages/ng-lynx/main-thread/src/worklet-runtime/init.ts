/**
 * Installs ng-lynx's worklet runtime when evaluated. `pluginAngularLynx` puts this
 * in the Main-Thread entry, after `entry-main` and before the app's
 * `mainThreadModules`. A build without the plugin imports it the same way:
 * `import 'ng-lynx/worklet-runtime'`, first among the Main-Thread modules.
 */
import { installWorkletRuntime } from './index.js';

installWorkletRuntime();
