/**
 * Inline `'main thread'` functions (docs/11-worklets.md#inline-main-thread-functions).
 *
 * A function whose body starts with the `'main thread'` directive runs on the Main
 * Thread, though it's written in a component. One analysis of the file's source
 * serves both bundles, so both agree on each function's id:
 *
 * - {@link transformForBackground} rewrites the function in place as
 *   `ɵinlineMainThread(id, () => ({ …captured }), <the function>)`. The function
 *   stays only for its type, so the IDE and the compiled code agree; the call
 *   returns a stub the runtime knows how to bind and serialize.
 * - {@link extractForMainThread} writes a module that registers each function on
 *   the Main Thread, as a factory taking what was captured. The function's text is
 *   copied unchanged, on its original line.
 *
 * Inside the function, a name resolves the way it reads:
 * - declared in the function: its own;
 * - imported by the file: imported again on the Main Thread, from the same module;
 * - declared anywhere else in the file: captured on the Background Thread when the
 *   function is bound or called, and sent across. So are `this.name` reads.
 * - declared nowhere (`Math`, `console`, `lynx`): a Main-Thread global.
 *
 * A CommonJS module (`.cts`) so rspack can load the loaders that use it.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import type * as TS from 'typescript';

/** The resource query of a file's Main-Thread half: `file.ts?ng-lynx-main-thread`. */
export const MAIN_THREAD_QUERY = 'ng-lynx-main-thread';

/** What the Background Thread calls each function's stub-maker. */
const BACKGROUND_HELPER = '__ngInlineMainThread';
/** What the Main Thread calls the registration function. */
const MAIN_THREAD_HELPER = '__ngRegisterInlineMainThread';
/** The factory's parameter, holding what was captured. */
const CAPTURED = '__ngCaptured';

const MARKER = /(['"])main thread\1/;

/** Whether the text could hold a `'main thread'` function: a cheap check before parsing. */
export function hasMainThreadMarker(text: string): boolean {
  return MARKER.test(text);
}

/** A problem with an inline function, reported against its source position. */
export class InlineMainThreadError extends Error {
  override readonly name = 'InlineMainThreadError';
}

/** Load the app's TypeScript (a peer of the Angular compiler), or this package's. */
export function loadTypeScript(root: string): typeof TS {
  try {
    return createRequire(path.join(root, 'package.json'))('typescript') as typeof TS;
  } catch {
    return createRequire(__filename)('typescript') as typeof TS;
  }
}

/** The file's path from the project root, with `/`, as the ids use it. */
export function relativeId(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}

type InlineNode =
  | TS.ArrowFunction
  | TS.FunctionExpression
  | TS.MethodDeclaration
  | TS.FunctionDeclaration;

interface ImportUse {
  specifier: string;
  kind: 'named' | 'default' | 'namespace';
  imported: string;
  local: string;
}

interface InlineFunction {
  node: InlineNode;
  id: string;
  /** Names declared elsewhere in the file, captured on the Background Thread. */
  captures: string[];
  /** `this.name` reads, captured as `this`'s members. */
  thisMembers: string[];
  imports: ImportUse[];
  /** 0-based line the function starts on. */
  line: number;
}

interface Analysis {
  source: TS.SourceFile;
  functions: InlineFunction[];
}

function hasDirective(ts: typeof TS, body: TS.Block): boolean {
  for (const statement of body.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === 'main thread') return true;
  }
  return false;
}

function isInline(ts: typeof TS, node: TS.Node): node is InlineNode {
  if (
    !ts.isArrowFunction(node)
    && !ts.isFunctionExpression(node)
    && !ts.isMethodDeclaration(node)
    && !ts.isFunctionDeclaration(node)
  ) {
    return false;
  }
  return !!node.body && ts.isBlock(node.body) && hasDirective(ts, node.body);
}

/** A checker for one file on its own: enough to tell where each name is declared. */
function createChecker(ts: typeof TS, source: TS.SourceFile, text: string): TS.TypeChecker {
  const name = source.fileName;
  const host: TS.CompilerHost = {
    getSourceFile: (file) => (file === name ? source : undefined),
    getDefaultLibFileName: () => 'lib.d.ts',
    writeFile: () => undefined,
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (file) => file,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (file) => file === name,
    readFile: (file) => (file === name ? text : undefined),
  };
  const options: TS.CompilerOptions = { noLib: true, noResolve: true, types: [], noEmit: true, target: ts.ScriptTarget.Latest };
  return ts.createProgram([name], options, host).getTypeChecker();
}

function isAssignmentTarget(ts: typeof TS, node: TS.Node): boolean {
  const parent = node.parent;
  if (ts.isBinaryExpression(parent) && parent.left === node) {
    const op = parent.operatorToken.kind;
    return op >= ts.SyntaxKind.FirstAssignment && op <= ts.SyntaxKind.LastAssignment;
  }
  if (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) {
    return parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken;
  }
  return ts.isDeleteExpression(parent);
}

/** An identifier in a position that names a property, not a variable. */
function isPropertyName(ts: typeof TS, node: TS.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent)) return parent.name === node;
  if (ts.isQualifiedName(parent)) return parent.right === node;
  if (ts.isBindingElement(parent)) return parent.propertyName === node;
  if (
    ts.isPropertyAssignment(parent)
    || ts.isPropertyDeclaration(parent)
    || ts.isMethodDeclaration(parent)
    || ts.isGetAccessorDeclaration(parent)
    || ts.isSetAccessorDeclaration(parent)
    || ts.isPropertySignature(parent)
    || ts.isMethodSignature(parent)
    || ts.isEnumMember(parent)
  ) {
    return parent.name === node;
  }
  return ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent) || ts.isMetaProperty(parent);
}

/** Specifiers whose code belongs to the Background Thread. */
function isBackgroundOnly(specifier: string): boolean {
  return specifier === 'ng-lynx' || specifier.startsWith('@angular/') || specifier === 'rxjs' || specifier.startsWith('rxjs/');
}

/**
 * Find the file's `'main thread'` functions and what each uses, or `undefined`
 * when it has none. Throws an {@link InlineMainThreadError} for one that can't
 * work.
 */
function analyze(ts: typeof TS, file: string, text: string, relativePath: string): Analysis | undefined {
  if (!hasMainThreadMarker(text)) return undefined;
  const source = ts.createSourceFile('/inline-main-thread.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const nodes: InlineNode[] = [];
  const findInline = (node: TS.Node): void => {
    if (isInline(ts, node)) {
      nodes.push(node);
      return; // A 'main thread' function inside one is plain Main-Thread code.
    }
    if (
      (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isConstructorDeclaration(node))
      && node.body
      && hasDirective(ts, node.body)
    ) {
      throw error(node, 'only a function, an arrow function or a method can be marked \'main thread\'.');
    }
    ts.forEachChild(node, findInline);
  };

  const error = (node: TS.Node, message: string): InlineMainThreadError => {
    const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
    return new InlineMainThreadError(`${file}:${line + 1}:${character + 1}: ${message}`);
  };

  findInline(source);
  if (nodes.length === 0) return undefined;

  const checker = createChecker(ts, source, text);
  const functions = nodes.map((node): InlineFunction => {
    const start = node.getStart(source);
    const { line, character } = source.getLineAndCharacterOfPosition(start);
    const captures = new Set<string>();
    const thisMembers = new Set<string>();
    const imports = new Map<string, ImportUse>();
    const inside = (decl: TS.Node): boolean => decl.pos >= node.pos && decl.end <= node.end;

    if (ts.isMethodDeclaration(node)) {
      if (ts.getDecorators(node)?.length) throw error(node, 'a \'main thread\' method can\'t have decorators.');
      if (node.asteriskToken) throw error(node, 'a \'main thread\' function can\'t be a generator.');
      if (node.questionToken) throw error(node, 'a \'main thread\' method can\'t be optional.');
      if (!ts.isIdentifier(node.name) && !ts.isStringLiteral(node.name)) {
        throw error(node, 'a \'main thread\' method needs a plain name.');
      }
    }
    if (ts.isFunctionDeclaration(node)) {
      if (!node.name) throw error(node, 'a \'main thread\' function declaration needs a name.');
      if (ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) {
        throw error(node, 'a \'main thread\' function can\'t be a default export: export it by name.');
      }
    }
    const objectMethod = ts.isMethodDeclaration(node) && ts.isObjectLiteralExpression(node.parent);

    const visit = (child: TS.Node, ownThis: boolean): void => {
      if (ts.isTypeNode(child) && !ts.isExpressionWithTypeArguments(child)) return;
      if (
        ts.isTypeParameterDeclaration(child)
        || ts.isInterfaceDeclaration(child)
        || ts.isTypeAliasDeclaration(child)
      ) {
        return;
      }

      if (child.kind === ts.SyntaxKind.SuperKeyword) throw error(child, 'a \'main thread\' function can\'t use `super`.');

      if (child.kind === ts.SyntaxKind.ThisKeyword && ownThis) {
        const parent = child.parent;
        if (!ts.isPropertyAccessExpression(parent) || parent.expression !== child || !ts.isIdentifier(parent.name)) {
          throw error(child, 'a \'main thread\' function can only read `this.name`: `this` itself stays on the Background Thread.');
        }
        if (objectMethod) {
          throw error(child, 'a \'main thread\' method of an object literal can\'t use `this`: use an arrow function in a class field.');
        }
        if (isAssignmentTarget(ts, parent)) {
          throw error(parent, `assigns to \`this.${parent.name.text}\`, which stays on the Background Thread. Keep state that changes on the Main Thread in a mainThreadRef.`);
        }
        thisMembers.add(parent.name.text);
        return;
      }

      if (ts.isIdentifier(child) && !isPropertyName(ts, child)) {
        const parent = child.parent;
        const symbol = ts.isShorthandPropertyAssignment(parent) && parent.name === child
          ? checker.getShorthandAssignmentValueSymbol(parent)
          : checker.getSymbolAtLocation(child);
        const decl = symbol?.declarations?.[0];
        if (symbol && decl && decl.getSourceFile() === source && !inside(decl)) {
          if (symbol.flags & ts.SymbolFlags.Alias) {
            const use = importUse(ts, decl, child, error);
            if (use) imports.set(use.local, use);
          } else if (!(symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.TypeParameter))) {
            if ((ts.isFunctionDeclaration(decl) && !isInline(ts, decl)) || ts.isClassDeclaration(decl)) {
              throw error(
                child,
                `\`${child.text}\` is a ${ts.isClassDeclaration(decl) ? 'class' : 'function'} in this file, which can't cross to the Main Thread. `
                  + 'Mark a function \'main thread\' too, or import it from a main-thread module.',
              );
            }
            if (isAssignmentTarget(ts, child)) {
              throw error(child, `assigns to \`${child.text}\`, which is captured from the Background Thread: the change would stay on the Main Thread. Use a mainThreadRef.`);
            }
            captures.add(child.text);
          }
        }
      }

      const childOwnThis = ownThis
        && !ts.isFunctionExpression(child)
        && !ts.isFunctionDeclaration(child)
        && !ts.isMethodDeclaration(child)
        && !ts.isClassLike(child)
        && !ts.isGetAccessorDeclaration(child)
        && !ts.isSetAccessorDeclaration(child)
        && !ts.isConstructorDeclaration(child);
      ts.forEachChild(child, (grandchild) => visit(grandchild, childOwnThis));
    };

    // Parameters and body: `this` there is the function's own.
    ts.forEachChild(node, (child) => {
      if (child === node.name || ts.isDecorator(child) || ts.isModifier(child)) return;
      visit(child, true);
    });

    return {
      node,
      id: `__ngInline:${relativePath}:${line + 1}:${character + 1}`,
      captures: [...captures].sort(),
      thisMembers: [...thisMembers].sort(),
      imports: [...imports.values()],
      line,
    };
  });

  return { source, functions };
}

function importUse(
  ts: typeof TS,
  decl: TS.Declaration,
  at: TS.Identifier,
  error: (node: TS.Node, message: string) => InlineMainThreadError,
): ImportUse | undefined {
  const declaration = ts.findAncestor(decl, ts.isImportDeclaration);
  if (!declaration) {
    throw error(at, `\`${at.text}\` comes from \`import … = require()\`, which a 'main thread' function can't use.`);
  }
  const clause = declaration.importClause;
  if (clause?.isTypeOnly || (ts.isImportSpecifier(decl) && decl.isTypeOnly)) return undefined;
  const specifier = (declaration.moduleSpecifier as TS.StringLiteral).text;
  if (isBackgroundOnly(specifier)) {
    throw error(
      at,
      `\`${at.text}\` comes from '${specifier}', which runs on the Background Thread. `
        + 'A \'main thread\' function can use what \'ng-lynx/worklet\' exports, and main-thread modules.',
    );
  }
  if (ts.isImportSpecifier(decl)) {
    return { specifier, kind: 'named', imported: (decl.propertyName ?? decl.name).text, local: decl.name.text };
  }
  if (ts.isImportClause(decl) && decl.name) return { specifier, kind: 'default', imported: 'default', local: decl.name.text };
  if (ts.isNamespaceImport(decl)) return { specifier, kind: 'namespace', imported: '*', local: decl.name.text };
  return undefined;
}

function captureExpression(fn: InlineFunction): string {
  const parts = [...fn.captures];
  if (fn.thisMembers.length > 0) {
    parts.push(`"this": { ${fn.thisMembers.map((m) => `${JSON.stringify(m)}: this.${m}`).join(', ')} }`);
  }
  return `() => ({ ${parts.join(', ')} })`;
}

/** The function as an arrow, from a method's or declaration's parts. */
function asArrow(ts: typeof TS, node: TS.MethodDeclaration | TS.FunctionDeclaration, source: TS.SourceFile): string {
  const isAsync = ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
  const typeParams = node.typeParameters ? `<${node.typeParameters.map((p) => p.getText(source)).join(', ')}>` : '';
  const params = node.parameters.map((p) => p.getText(source)).join(', ');
  const ret = node.type ? `: ${node.type.getText(source)}` : '';
  return `${isAsync ? 'async ' : ''}${typeParams}(${params})${ret} => ${node.body!.getText(source)}`;
}

/** The function as a `function` expression, from a declaration. */
function declarationAsExpression(ts: typeof TS, node: TS.FunctionDeclaration, source: TS.SourceFile): string {
  const isAsync = ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
  const typeParams = node.typeParameters ? `<${node.typeParameters.map((p) => p.getText(source)).join(', ')}>` : '';
  const params = node.parameters.map((p) => p.getText(source)).join(', ');
  const ret = node.type ? `: ${node.type.getText(source)}` : '';
  return `${isAsync ? 'async ' : ''}function ${node.name!.text}${typeParams}(${params})${ret} ${node.body!.getText(source)}`;
}

/**
 * The file as the Background Thread compiles it: each `'main thread'` function
 * becomes a stub carrying its id and what it captures. `undefined` when the file
 * has none. The text keeps its lines, so diagnostics and source maps still point
 * at the right place.
 */
export function transformForBackground(
  ts: typeof TS,
  file: string,
  text: string,
  relativePath: string,
): string | undefined {
  const analysis = analyze(ts, file, text, relativePath);
  if (!analysis) return undefined;
  const { source, functions } = analysis;

  const edits = functions.map((fn) => {
    const { node } = fn;
    const call = (inner: string): string =>
      `${BACKGROUND_HELPER}(${JSON.stringify(fn.id)}, ${captureExpression(fn)}, ${inner})`;
    if (ts.isMethodDeclaration(node)) {
      const name = node.name.getText(source);
      if (ts.isObjectLiteralExpression(node.parent)) {
        return { start: node.getStart(source), end: node.end, text: `${name}: ${call(asArrow(ts, node, source))}` };
      }
      const modifiers = (ts.getModifiers(node) ?? [])
        .filter((m) => m.kind !== ts.SyntaxKind.AsyncKeyword)
        .map((m) => m.getText(source));
      if (!modifiers.includes('readonly')) modifiers.push('readonly');
      return {
        start: node.getStart(source),
        end: node.end,
        text: `${modifiers.join(' ')} ${name} = ${call(asArrow(ts, node, source))};`,
      };
    }
    if (ts.isFunctionDeclaration(node)) {
      const exported = ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      return {
        start: node.getStart(source),
        end: node.end,
        text: `${exported ? 'export ' : ''}const ${node.name!.text} = ${call(declarationAsExpression(ts, node, source))};`,
      };
    }
    return { start: node.getStart(source), end: node.end, text: call(node.getText(source)) };
  });

  let out = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  // On the first line, so every line keeps its number.
  return `import { ɵinlineMainThread as ${BACKGROUND_HELPER} } from 'ng-lynx'; ${out}`;
}

/**
 * The file's Main-Thread half: a module registering each `'main thread'` function,
 * with the imports they use. Empty when the file has none. Each function keeps the
 * line it had, so a Main-Thread stack trace points at the source.
 */
export function extractForMainThread(ts: typeof TS, file: string, text: string, relativePath: string): string {
  const analysis = analyze(ts, file, text, relativePath);
  if (!analysis) return '';
  const { source, functions } = analysis;

  const lines: string[] = [`import { ɵregisterInlineMainThread as ${MAIN_THREAD_HELPER} } from 'ng-lynx/worklet';`];
  const seen = new Set<string>();
  for (const use of functions.flatMap((fn) => fn.imports)) {
    if (seen.has(use.local)) continue;
    seen.add(use.local);
    const from = JSON.stringify(use.specifier);
    if (use.kind === 'named') lines.push(`import { ${use.imported === use.local ? use.local : `${use.imported} as ${use.local}`} } from ${from};`);
    else if (use.kind === 'default') lines.push(`import ${use.local} from ${from};`);
    else lines.push(`import * as ${use.local} from ${from};`);
  }

  let out = lines.join(' ');
  let line = 0;
  for (const fn of functions) {
    const { node } = fn;
    let expression: string;
    if (ts.isArrowFunction(node)) expression = node.getText(source);
    else if (ts.isMethodDeclaration(node)) expression = asArrow(ts, node, source);
    else if (ts.isFunctionDeclaration(node)) expression = `(${declarationAsExpression(ts, node, source)}).bind(this)`;
    else expression = `(${node.getText(source)}).bind(this)`;
    const declarations = fn.captures.map((name) => `${name} = ${CAPTURED}[${JSON.stringify(name)}]`);
    const prelude = declarations.length > 0 ? `const ${declarations.join(', ')}; ` : '';
    const call = `${MAIN_THREAD_HELPER}(${JSON.stringify(fn.id)}, function (${CAPTURED}: any) { ${prelude}`
      + `return (function (this: any) { return ${expression}; }).call(${CAPTURED}["this"]); });`;
    // Pad to the function's own line; a function sharing a line with the last one
    // just follows it.
    if (fn.line > line) {
      out += '\n'.repeat(fn.line - line);
      line = fn.line;
    } else {
      out += ' ';
    }
    out += call;
    line += call.split('\n').length - 1;
  }
  return `${out}\n`;
}

/** Folders a scan never enters. */
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'build', 'ios', 'android', 'harmony', 'Pods', 'artifacts']);

/**
 * The `.ts` files under `roots` that mention `'main thread'`: each gets a
 * Main-Thread half. Skips declarations, tests, hidden and build folders, and
 * `exclude` (the `mainThreadModules`, already Main-Thread code).
 */
export function scanForMainThreadFiles(roots: readonly string[], exclude: ReadonlySet<string>): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names.sort()) {
      if (name.startsWith('.') || SKIPPED_DIRS.has(name)) continue;
      const full = path.join(dir, name);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        walk(full);
        continue;
      }
      if (!isScannable(full) || exclude.has(full)) continue;
      try {
        if (hasMainThreadMarker(readFileSync(full, 'utf8'))) found.push(full);
      } catch {
        // Unreadable: not ours to report.
      }
    }
  };
  for (const root of roots) if (existsSync(root)) walk(root);
  return found;
}

/** A source file that may hold `'main thread'` functions. */
export function isScannable(file: string): boolean {
  return /\.[cm]?ts$/.test(file) && !/\.d\.[cm]?ts$/.test(file) && !/\.(spec|test)\.[cm]?ts$/.test(file);
}

/** A short, stable hash for cache keys. */
export function contentHash(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 16);
}
