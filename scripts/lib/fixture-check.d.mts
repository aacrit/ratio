// Types for fixture-check.mjs, so tests/fixture-check.test.ts can import it
// without a type escape hatch.
export interface FixtureArgs {
  update: boolean;
  base: string | null;
  browsers: string[] | null;
  allowUnsupported: string[];
}
export interface FixtureResult {
  hash?: string;
  error?: string;
}
export declare function parseArgs(argv: string[]): FixtureArgs;
export declare function allFailedAlike(resultsForBrowser: Record<string, FixtureResult>, fixtureCount: number): boolean;
export declare function duplicateHashes(byFixture: Record<string, FixtureResult>): string[];
export declare function refusedDowngrades(lockBrowsers: Record<string, string> | undefined, nowUnsupported: string[], allowed: string[]): string[];
