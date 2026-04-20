// Polyfills browser IndexedDB in the Node test environment.
// Loaded once per test file before the test body runs.
import "fake-indexeddb/auto";
