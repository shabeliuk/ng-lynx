import { Rule, SchematicContext, SchematicsException, Tree } from '@angular-devkit/schematics';

/**
 * `ng add ng-lynx` — scaffolds a Lynx build target into an existing
 * Angular CLI workspace, next to (not replacing) its existing web app.
 *
 * Deliberately does NOT wire a custom `angular.json` architect builder: Lynx
 * apps build through `@lynx-js/rspeedy` (its own CLI, not an Angular CLI
 * builder), so the added target is plain npm scripts that shell out to it —
 * the same thing `create-ng-lynx`-scaffolded apps do. It also does not
 * attempt to port the workspace's existing root component: that component is
 * DOM-bound (likely `BrowserModule`/`RouterOutlet` wired to browser
 * `location`), none of which runs on Lynx's dual-thread engine. Instead this
 * generates a fresh, self-contained Lynx entry point — share business-logic
 * components into it afterward, same as adding any new platform target.
 */
export interface NgAddOptions {
  directory?: string;
}

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

const RSPEEDY_VERSION = '^0.18.4';
const QRCODE_PLUGIN_VERSION = '^0.7.3';
const FALLBACK_ANGULAR_VERSION = '^22.0.0';

export function ngAdd(options: NgAddOptions): Rule {
  return (tree: Tree, context: SchematicContext) => {
    const directory = normalizeDirectory(options.directory ?? 'lynx');

    if (!tree.exists('package.json')) {
      throw new SchematicsException(
        'No package.json found at the workspace root — run `ng add ng-lynx` from '
          + 'the root of an Angular CLI workspace.',
      );
    }
    if (tree.exists(`${directory}/lynx.config.ts`)) {
      throw new SchematicsException(
        `${directory}/lynx.config.ts already exists — remove it first, or pass a `
          + `different target: ng add ng-lynx --directory <name>.`,
      );
    }

    const pkg = JSON.parse(tree.readText('package.json')) as PackageJson;
    updatePackageJson(tree, pkg, directory);
    updateGitignore(tree, directory);
    createLynxFiles(tree, directory, pkg.name);

    context.logger.info(
      `\nAdded a Lynx target at ${directory}/\n\n`
        + 'Next steps:\n'
        + '  npm install\n'
        + `  npm run lynx:dev\n\n`
        + 'Then open the web preview at\n'
        + '  http://localhost:3000/__web_preview?casename=main.web.bundle\n'
        + 'or scan the printed QR code with Lynx Explorer on a device/simulator.\n',
    );

    return tree;
  };
}

function normalizeDirectory(directory: string): string {
  const trimmed = directory.replace(/^\/+|\/+$/g, '');
  if (!trimmed || trimmed.startsWith('.') || trimmed.includes('..') || trimmed.includes('\\')) {
    throw new SchematicsException(`Invalid --directory "${directory}".`);
  }
  return trimmed;
}

function updatePackageJson(tree: Tree, pkg: PackageJson, directory: string): void {
  const devDependencies = (pkg.devDependencies ??= {});
  const angularVersion = pkg.dependencies?.['@angular/core'] ?? pkg.devDependencies?.['@angular/core']
    ?? FALLBACK_ANGULAR_VERSION;

  const neededDevDeps: Record<string, string> = {
    '@lynx-js/rspeedy': RSPEEDY_VERSION,
    '@lynx-js/qrcode-rsbuild-plugin': QRCODE_PLUGIN_VERSION,
    '@angular/compiler-cli': angularVersion,
    '@ngtools/webpack': angularVersion,
  };
  for (const [name, version] of Object.entries(neededDevDeps)) {
    // Only fill in missing pins — never downgrade/overwrite a version the
    // workspace already has (idempotent on repeat `ng add` runs).
    devDependencies[name] ??= version;
  }

  const scripts = (pkg.scripts ??= {});
  // `--root` pins rspeedy's project root to the target directory explicitly:
  // npm scripts run with cwd = the workspace root (where this package.json
  // lives), not `<directory>/` — without `--root` rspeedy would resolve
  // `source.entry` against the wrong base and never find `src/index.ts`.
  // Once `--root` is given, `--config` resolves *relative to that root*
  // (confirmed empirically — passing the workspace-relative path here
  // double-joins into `<directory>/<directory>/lynx.config.ts`), so it's
  // just the bare filename.
  scripts['lynx:dev'] ??= `rspeedy dev --root ${directory} --config lynx.config.ts`;
  scripts['lynx:build'] ??= `rspeedy build --root ${directory} --config lynx.config.ts`;

  tree.overwrite('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
}

function updateGitignore(tree: Tree, directory: string): void {
  const ignoreLines = [`${directory}/dist/`, `${directory}/.rspeedy/`];
  if (!tree.exists('.gitignore')) {
    tree.create('.gitignore', `${ignoreLines.join('\n')}\n`);
    return;
  }
  const existing = tree.readText('.gitignore');
  const missing = ignoreLines.filter((line) => !existing.includes(line));
  if (missing.length > 0) {
    tree.overwrite('.gitignore', `${existing.replace(/\n*$/, '\n')}\n# ng-lynx\n${missing.join('\n')}\n`);
  }
}

function createLynxFiles(tree: Tree, directory: string, workspaceName: string | undefined): void {
  const appName = workspaceName ?? 'Angular + Lynx';

  tree.create(
    `${directory}/lynx.config.ts`,
    `import { defineConfig } from '@lynx-js/rspeedy';

import { pluginQRCode } from '@lynx-js/qrcode-rsbuild-plugin';
import { pluginAngularLynx } from 'ng-lynx/plugin';

export default defineConfig({
  source: {
    entry: {
      main: './src/index.ts',
    },
  },
  environments: {
    // \`lynx\` builds the on-device bundle; \`web\` builds the browser preview.
    lynx: {},
    web: {},
  },
  plugins: [
    pluginQRCode({
      // Open the page full-screen in Lynx Explorer when scanning the QR code.
      schema(url) {
        return \`\${url}?fullscreen=true\`;
      },
    }),
    pluginAngularLynx({
      enableCSSSelector: true,
      enableCSSInheritance: true,
      // \`--root ${directory}\` (see the lynx:dev/lynx:build scripts in
      // package.json) only affects rspeedy's own path resolution — this
      // plugin resolves \`tsconfig\` against the process's actual cwd, which
      // is the *workspace* root the npm scripts run from, not this
      // directory. Spelled out explicitly so AOT reads the right project
      // instead of silently picking up a root-level tsconfig.json.
      tsconfig: '${directory}/tsconfig.json',
      // AOT (ngtsc) is the default. See the ng-lynx docs for
      // \`firstScreen\` (instant first frame) and other options.
    }),
  ],
});
`,
  );

  tree.create(
    `${directory}/tsconfig.json`,
    `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "preserve",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "experimentalDecorators": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "useDefineForClassFields": false
  },
  "angularCompilerOptions": {
    "strictTemplates": true
  },
  "include": ["src"]
}
`,
  );

  tree.create(
    `${directory}/src/rspeedy-env.d.ts`,
    `// Types for what the build handles: \`import logo from './logo.png'\`, \`import './app.css'\`, ...
/// <reference types="@lynx-js/rspeedy/client" />
`,
  );

  tree.create(
    `${directory}/src/index.ts`,
    `import { bootstrapLynxApplication } from 'ng-lynx';

import './app.css';
import { AppComponent } from './app.component.js';

// Mounts AppComponent onto the Lynx page root. No host selector, no Zone.js —
// signals drive change detection; the renderer ships ops to the Main Thread.
bootstrapLynxApplication(AppComponent).catch((err) => {
  console.error('[ng-lynx] bootstrap failed', err);
});
`,
  );

  tree.create(
    `${directory}/src/app.component.ts`,
    `import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import { LYNX_ELEMENTS, type LynxTouchEvent } from 'ng-lynx/elements';

/**
 * A standalone, zoneless Angular component rendering Lynx elements.
 *
 * \`LYNX_ELEMENTS\` makes the Lynx tags (\`view\`, \`text\`, …) known to the
 * template compiler — fully type-checked under \`strictTemplates\` — and types
 * \`$event\` on Lynx events like \`(tap)\`.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS],
  template: \`
    <view class="app">
      <view class="banner">
        <text class="title">${appName}</text>
        <text class="subtitle">Angular on Lynx — zoneless · signals</text>
      </view>

      <view class="counter" (tap)="increment($event)">
        <text class="count">{{ count() }}</text>
        <text class="hint">Tap to increment</text>
      </view>

      <text class="parity">{{ count() }} is {{ isEven() ? 'even' : 'odd' }}</text>
    </view>
  \`,
})
export class AppComponent {
  readonly count = signal(0);
  readonly isEven = computed(() => this.count() % 2 === 0);

  increment(_event: LynxTouchEvent): void {
    this.count.update((n) => n + 1);
  }
}
`,
  );

  tree.create(
    `${directory}/src/app.css`,
    `/*
 * Lynx applies these via its CSS engine using class selectors. Keep styles in
 * CSS files imported from index.ts (component \`styles: [...]\` are not
 * projected on Lynx). Flexbox is the default layout; dimensions need units.
 */
.app {
  flex: 1;
  display: flex;
  flex-direction: column;
  /* Static status-bar buffer — Lynx exposes no safe-area inset yet. */
  padding: 56px 24px 24px;
  background-color: #0b1021;
}

.banner {
  margin-bottom: 32px;
}

.title {
  font-size: 28px;
  font-weight: bold;
  color: #ffffff;
}

.subtitle {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
  margin-top: 4px;
}

.counter {
  align-items: center;
  justify-content: center;
  padding: 32px;
  border-radius: 16px;
  background-color: #dd0031;
}

.count {
  font-size: 48px;
  font-weight: bold;
  color: #ffffff;
}

.hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
  margin-top: 8px;
}

.parity {
  margin-top: 16px;
  font-size: 16px;
  color: #ffce54;
}
`,
  );
}
