#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { GitHubClient } from './github/client';
import { IssueOrchestrator } from './agent/orchestrator';
import { config, validateConfig } from './config';
import { runner } from './runner';
import { checkPrerequisites, printPrerequisitesCheck } from './prerequisites';

const program = new Command();

program
  .name('agent-orchestrator')
  .description('GitHub Agent Orchestrator - Automated issue processing')
  .version('0.1.0');

program
  .command('run')
  .description('Run the orchestrator (single repo mode)')
  .option('--dry-run', 'Simulate without making changes')
  .option('-i, --interval <seconds>', 'Polling interval', config.polling.interval.toString())
  .option('-m, --model <model>', 'AI model to use (e.g., gpt-4, claude-3)')
  .action(async (options) => {
    console.log(chalk.cyan.bold('\n🤖 GitHub Agent Orchestrator\n'));

    if (options.model) {
      config.agent.model = options.model;
      console.log(`   Model: ${chalk.green(options.model)}`);
    } else {
      console.log(`   Model: ${chalk.green(config.agent.model)} (default)`);
    }

    if (!validateConfig()) {
      process.exit(1);
    }

    const client = new GitHubClient(config.github.token, config.github.repo, config.github.repoPath);
    const orchestrator = new IssueOrchestrator(client, options.dryRun);

    console.log(chalk.green('✅ Connected!'));
    console.log(`   Repository: ${config.github.repo}`);
    console.log(`   Local path: ${config.github.repoPath}`);
    console.log(`   Mode: ${options.dryRun ? chalk.yellow('DRY RUN') : chalk.green('LIVE')}\n`);

    const issues = await client.getOpenIssues([config.labels.ready]);

    if (issues.length === 0) {
      console.log(chalk.gray('No issues found with "agent:ready" label.'));
      return;
    }

    console.log(chalk.cyan(`Found ${issues.length} issue(s):\n`));

    for (const issue of issues) {
      await orchestrator.processIssue(issue);
    }

    const stats = orchestrator.getStats();
    console.log(chalk.bold('\n📊 Final Statistics:'));
    console.log(`   Processed: ${stats.processed}`);
    console.log(`   Successful: ${chalk.green(stats.successful)}`);
    console.log(`   Failed: ${chalk.red(stats.failed)}`);
  });

program
  .command('daemon')
  .description('Run as daemon (single repo mode)')
  .option('--dry-run', 'Simulate without making changes')
  .option('-i, --interval <seconds>', 'Polling interval', config.polling.interval.toString())
  .option('-m, --model <model>', 'AI model to use (e.g., gpt-4, claude-3)')
  .action(async (options) => {
    console.log(chalk.cyan.bold('\n🤖 GitHub Agent Orchestrator - Daemon Mode\n'));

    if (options.model) {
      config.agent.model = options.model;
      console.log(`   Model: ${chalk.green(options.model)}`);
    } else {
      console.log(`   Model: ${chalk.green(config.agent.model)} (default)`);
    }

    if (!validateConfig()) {
      process.exit(1);
    }

    const client = new GitHubClient(config.github.token, config.github.repo, config.github.repoPath);
    const orchestrator = new IssueOrchestrator(client, options.dryRun);

    console.log(chalk.green('✅ Connected!'));
    console.log(`   Repository: ${config.github.repo}`);
    console.log(`   Local path: ${config.github.repoPath}`);
    console.log(chalk.yellow('\n🕐 Running continuously...'));
    console.log(chalk.gray('Press Ctrl+C to stop\n'));

    const { IssueMonitor } = await import('./polling/monitor');
    
    const monitor = new IssueMonitor(client, {
      pollingInterval: parseInt(options.interval),
      labelFilter: [config.labels.ready],
    });

    monitor.start(async (issue: any) => {
      console.log(chalk.bold(`\n📬 New issue detected: #${issue.number}`));
      await orchestrator.processIssue(issue);
    });

    process.on('SIGINT', () => {
      console.log(chalk.yellow('\n\nShutting down...'));
      monitor.stop();
      process.exit(0);
    });
  });

program
  .command('web')
  .description('Start web dashboard and multi-repo orchestrator')
  .option('-p, --port <port>', 'Port for web dashboard', '9999')
  .action(async (options) => {
    // Check prerequisites first
    printPrerequisitesCheck();
    const prereqs = checkPrerequisites();
    if (!prereqs.ok) {
      console.log(chalk.red('❌ Cannot start - please fix the issues above.\n'));
      process.exit(1);
    }

    // Set port for web server
    process.env.PORT = options.port;

    // Start the runner
    await runner.start();
    
    // Import and start web server
    const { default: express } = await import('express');
    const cors = await import('cors');
    const path = await import('path');
    
    const app = express();
    app.use(cors.default);
    app.use(express.json());
    app.use(express.static(path.join(__dirname, '../public')));
    
    // Health check
    app.get('/api/health', (req: any, res: any) => {
      res.json({ 
        status: 'ok', 
        runner: runner.getStatus(),
        timestamp: new Date().toISOString() 
      });
    });
    
    // Forward all other API requests to web server
    const { default: webServer } = await import('./web/server');
    // Use the web server's routes
    
    console.log(chalk.green(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   🤖 GitHub Agent Orchestrator - Web Mode                     ║
║                                                               ║
║   Dashboard: http://localhost:${options.port}                       ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
    `));
    
    console.log(chalk.yellow('Press Ctrl+C to stop\n'));
    
    process.on('SIGINT', () => {
      console.log(chalk.yellow('\nShutting down...'));
      runner.stop();
      process.exit(0);
    });
  });

program
  .command('list')
  .description('List issues with agent labels (single repo mode)')
  .action(async () => {
    if (!validateConfig()) {
      process.exit(1);
    }

    const client = new GitHubClient(config.github.token, config.github.repo, config.github.repoPath);
    const issues = await client.getOpenIssues();

    const agentLabels = Object.values(config.labels);
    const agentIssues = issues.filter((issue: any) =>
      issue.labels.some((label: string) => agentLabels.includes(label))
    );

    console.log(chalk.cyan('\n📋 Issues with agent labels:\n'));

    if (agentIssues.length === 0) {
      console.log(chalk.gray('No agent-related issues found.'));
      return;
    }

    const table = new Table({
      head: ['#', 'Title', 'Author', 'Labels', 'Status'],
      colWidths: [6, 40, 15, 25, 12],
    });

    for (const issue of agentIssues) {
      const status =
        issue.labels.includes(config.labels.ready)
          ? 'ready'
          : issue.labels.includes(config.labels.implementing)
          ? 'working'
          : issue.labels.includes(config.labels.done)
          ? 'done'
          : issue.labels.includes(config.labels.failed)
          ? 'failed'
          : 'unknown';

      const statusColor =
        status === 'ready'
          ? 'green'
          : status === 'working'
          ? 'yellow'
          : status === 'done'
          ? 'blue'
          : 'red';

      table.push([
        issue.number,
        issue.title.substring(0, 38) + (issue.title.length > 38 ? '...' : ''),
        issue.author,
        issue.labels.slice(0, 2).join(', ') + (issue.labels.length > 2 ? '...' : ''),
        chalk[statusColor](status),
      ]);
    }

    console.log(table.toString());
  });

program
  .command('status <issue-number>')
  .description('Get status of a specific issue')
  .action(async (issueNumber) => {
    if (!validateConfig()) {
      process.exit(1);
    }

    const client = new GitHubClient(config.github.token, config.github.repo, config.github.repoPath);
    const issue = await client.getIssue(parseInt(issueNumber));

    if (!issue) {
      console.log(chalk.red(`Issue #${issueNumber} not found`));
      return;
    }

    console.log(chalk.cyan.bold(`\nIssue #${issue.number}: ${issue.title}\n`));
    console.log(`Author: @${issue.author}`);
    console.log(`Labels: ${issue.labels.join(', ') || 'none'}`);
    console.log(`Created: ${issue.createdAt}`);
    console.log(`URL: ${issue.htmlUrl}`);
  });

program.parse();
