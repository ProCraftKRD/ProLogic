import { runOperationsTests } from './operations.test';
import { runCircuitsTests } from './circuits.test';
import { runSimulationTests } from './simulation.test';
import { runParserTests } from './parser.test';
import { runInteractionTests } from './interaction.test';
import { runUndoRedoTests } from './undoredo.test';
import { runSettingsTests } from './settings.test';
import { runExportTests } from './export.test';
import { runDocumentLifecycleTests } from './documentLifecycle.test';
import { runShellIntegrationTests } from './shellIntegration.test';
import { runUniversalImporterTests } from './universalImporter.test';
import { runLabelTests } from './label.test';
import { runQAAuditVerificationTests } from './qaAuditVerification.test';

export interface TestResult {
  name: string;
  passed: boolean;
  error?: any;
}

export class TestSuite {
  private _results: TestResult[] = [];

  constructor(public name: string) {}

  public test(name: string, fn: () => void): void {
    try {
      fn();
      this._results.push({ name, passed: true });
      console.log(`  ✓ ${name}`);
    } catch (err: any) {
      this._results.push({ name, passed: false, error: err });
      console.error(`  ✗ ${name}`);
      console.error(`    ${err.message || err}`);
    }
  }

  public async testAsync(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      this._results.push({ name, passed: true });
      console.log(`  ✓ ${name}`);
    } catch (err: any) {
      this._results.push({ name, passed: false, error: err });
      console.error(`  ✗ ${name}`);
      console.error(`    ${err.message || err}`);
    }
  }

  public report(): boolean {
    const passed = this._results.filter((r) => r.passed).length;
    const total = this._results.length;
    console.log(`\nResults for ${this.name}: ${passed}/${total} passed\n`);
    return passed === total;
  }
}

export function assert(condition: boolean, message?: string): asserts condition {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

export function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(`${message ? message + ': ' : ''}Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export async function main(): Promise<void> {
  console.log('=====================================================');
  console.log(' ProLogic Test Suite - Clean-room Simulation Engine  ');
  console.log('=====================================================\n');

  let allPassed = true;
  allPassed = runOperationsTests() && allPassed;
  allPassed = runCircuitsTests() && allPassed;
  allPassed = runSimulationTests() && allPassed;
  allPassed = runParserTests() && allPassed;
  allPassed = runInteractionTests() && allPassed;
  allPassed = runUndoRedoTests() && allPassed;
  allPassed = runSettingsTests() && allPassed;
  allPassed = (await runExportTests()) && allPassed;
  allPassed = (await runDocumentLifecycleTests()) && allPassed;
  allPassed = (await runShellIntegrationTests()) && allPassed;
  allPassed = runUniversalImporterTests() && allPassed;
  allPassed = runLabelTests() && allPassed;
  allPassed = runQAAuditVerificationTests() && allPassed;

  console.log('=====================================================');
  if (allPassed) {
    console.log(' ALL SUITES PASSED! Simulation Engine 100% Verified. ');
  } else {
    console.error(' SOME TESTS FAILED! Check output above.              ');
    process.exit(1);
  }
  console.log('=====================================================');
}

if (require.main === module) {
  main();
}
