import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const reportsDir = join(root, 'test-reports', 'e2e');
const playwrightCli = join(root, 'node_modules', '@playwright', 'test', 'cli.js');

type ReportStats = {
  expected?: number;
  unexpected?: number;
  flaky?: number;
  skipped?: number;
  duration?: number;
};

type ArchivedReport = {
  id: string;
  directory: string;
  stats: ReportStats;
};

function archivedReports(): ArchivedReport[] {
  if (!existsSync(reportsDir)) return [];
  return readdirSync(reportsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const directory = join(reportsDir, entry.name);
      const resultsFile = join(directory, 'results.json');
      if (!existsSync(join(directory, 'index.html')) || !existsSync(resultsFile)) return null;
      const report = JSON.parse(readFileSync(resultsFile, 'utf8')) as { stats?: ReportStats };
      return { id: entry.name, directory, stats: report.stats ?? {} };
    })
    .filter((report): report is ArchivedReport => report !== null)
    .sort((a, b) => b.id.localeCompare(a.id));
}

function formatDuration(ms = 0): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function listReports(): void {
  const reports = archivedReports();
  if (reports.length === 0) {
    console.log('No archived E2E reports yet. Run `npm run test:e2e` first.');
    return;
  }
  console.log('Saved E2E reports (newest first):');
  for (const report of reports) {
    console.log(
      `${report.id}  passed ${report.stats.expected ?? 0} · failed ${report.stats.unexpected ?? 0} · flaky ${report.stats.flaky ?? 0} · skipped ${report.stats.skipped ?? 0} · ${formatDuration(report.stats.duration)}`,
    );
  }
}

function runPlaywright(args: string[], reportDir: string): Promise<number> {
  return new Promise((resolveExit) => {
    const child = spawn(
      process.execPath,
      [playwrightCli, 'test', '-c', 'playwright.e2e.config.ts', ...args],
      {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, FINSENTINEL_E2E_REPORT_DIR: reportDir },
      },
    );
    child.on('error', (error) => {
      console.error(`Could not start Playwright: ${error.message}`);
      resolveExit(1);
    });
    child.on('close', (code) => resolveExit(code ?? 1));
  });
}

async function runTests(args: string[]): Promise<void> {
  if (!existsSync(playwrightCli)) {
    throw new Error('Playwright is not installed. Run npm ci before starting the E2E suite.');
  }
  mkdirSync(reportsDir, { recursive: true });
  const runId = new Date().toISOString().replace(/[-:.]/g, '');
  const reportDir = join(reportsDir, runId);
  mkdirSync(reportDir);
  console.log(`This run's HTML and JSON reports will be saved in ${relative(root, reportDir)}.`);

  const exitCode = await runPlaywright(args, reportDir);
  if (existsSync(join(reportDir, 'index.html')) && existsSync(join(reportDir, 'results.json'))) {
    console.log(`Saved E2E report: ${relative(root, join(reportDir, 'index.html'))}`);
    console.log('View the latest report with `npm run test:e2e:report`.');
  } else {
    console.error(`Playwright did not produce both report files in ${relative(root, reportDir)}.`);
  }
  process.exitCode = exitCode;
}

function showReport(args: string[]): void {
  if (args.includes('--list')) {
    listReports();
    return;
  }
  const selector = args.find((arg) => !arg.startsWith('-'));
  const reports = archivedReports();
  const report = selector
    ? reports.find((entry) => entry.id === selector || entry.id.startsWith(selector))
    : reports[0];
  if (!report) {
    if (selector) {
      throw new Error(`No saved E2E report matches "${selector}". Use --list to see saved runs.`);
    }
    throw new Error('No archived E2E reports yet. Run `npm run test:e2e` first.');
  }
  if (!existsSync(playwrightCli)) {
    throw new Error('Playwright is not installed. Run npm ci before viewing reports.');
  }
  console.log(`Opening E2E report ${report.id}. Press Ctrl+C to stop the local report server.`);
  const child = spawn(process.execPath, [playwrightCli, 'show-report', report.directory], {
    cwd: root,
    stdio: 'inherit',
  });
  child.on('error', (error) => {
    console.error(`Could not open the Playwright report: ${error.message}`);
    process.exitCode = 1;
  });
  child.on('close', (code) => {
    process.exitCode = code ?? 1;
  });
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'test') {
    await runTests(args);
  } else if (command === 'report') {
    showReport(args);
  } else {
    throw new Error('Usage: node scripts/e2e.ts <test [Playwright args...] | report [run-id | --list]>');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
