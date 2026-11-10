/**
 * The mock PAPI now lives in the public `angular-lynx/testing` package
 * (`testing/src/mock-papi.ts`) — this shim keeps the harnesses' imports
 * stable. New harness code can import from either place.
 */
export * from '../testing/src/mock-papi.js';
