/**
 * esbuild, for the two command-line tools that need it.
 *
 * It's an optional peer dependency rather than a dependency: only these tools
 * use it, and installing it runs a postinstall script that npm 11 warns about on
 * every install. So an app that never runs them never gets it.
 */
export async function loadEsbuild(tool) {
  try {
    return await import('esbuild');
  } catch (err) {
    if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err;
    console.error(
      `${tool} needs esbuild, which ng-lynx doesn't install for you. Add it to your app:\n\n`
        + '  npm install --save-dev esbuild\n',
    );
    process.exit(1);
  }
}
