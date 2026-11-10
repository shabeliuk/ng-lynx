// Lets `node --test` load the app's TypeScript as-is: the app imports its own
// modules as `./x.js` (bundler style), so map a missing `.js` to its `.ts`.
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (specifier.startsWith('.') && specifier.endsWith('.js')) {
      return next(`${specifier.slice(0, -3)}.ts`, context);
    }
    throw error;
  }
}
