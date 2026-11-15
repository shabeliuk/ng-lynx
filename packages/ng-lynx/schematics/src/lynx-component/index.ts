import { Rule, SchematicsException, Tree } from '@angular-devkit/schematics';
import { strings } from '@angular-devkit/core';

/**
 * `ng generate ng-lynx:lynx-component <name>` — a standalone, OnPush
 * component using the typed Lynx elements (`ng-lynx/elements`), styled
 * via a companion CSS file (docs/13-styling.md's convention: Lynx CSS lives
 * in files imported from the entry point, not component `styles: [...]`).
 */
export interface LynxComponentOptions {
  name: string;
  path?: string;
  flat?: boolean;
  skipCss?: boolean;
}

export function lynxComponent(options: LynxComponentOptions): Rule {
  return (tree: Tree) => {
    if (!options.name) {
      throw new SchematicsException(
        'A component name is required: ng generate ng-lynx:lynx-component <name>',
      );
    }

    const dasherized = strings.dasherize(options.name);
    const className = `${strings.classify(options.name)}Component`;
    const basePath = (options.path ?? 'src').replace(/\/+$/, '');
    const dir = options.flat === false ? `${basePath}/${dasherized}` : basePath;
    const tsPath = `${dir}/${dasherized}.component.ts`;
    const cssPath = `${dir}/${dasherized}.component.css`;

    if (tree.exists(tsPath)) {
      throw new SchematicsException(`${tsPath} already exists.`);
    }

    const cssImport = options.skipCss ? '' : `\nimport './${dasherized}.component.css';\n`;
    tree.create(
      tsPath,
      `import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';
${cssImport}
@Component({
  selector: '${dasherized}',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS],
  template: \`
    <view class="${dasherized}">
      <text>${className} works!</text>
    </view>
  \`,
})
export class ${className} {}
`,
    );

    if (!options.skipCss) {
      tree.create(
        cssPath,
        `.${dasherized} {
  display: flex;
}
`,
      );
    }

    return tree;
  };
}
