import { GitHubClient } from './github/client';
import { IssueMonitor, MonitorConfig } from './polling/monitor';
import { IssueOrchestrator } from './agent/orchestrator';
import { TaskExecutor } from './agent/executor';
import { db, ManagedRepo, ProcessingLog } from './web/database';
import { config } from './config';
import { v4 as uuidv4 } from 'uuid';
import chalk from 'chalk';

interface RepoWorker {
  repoId: string;
  repoName: string;
  githubRepo: string;
  localPath: string;
  pollingInterval: number;
  labelFilter: string[];
  executor: TaskExecutor;
}

export class OrchestratorRunner {
  private workers: Map<string, RepoWorker> = new Map();
  private running: boolean = false;
  private pollTimers: Map<string, NodeJS.Timeout> = new Map();

  async start(): Promise<void> {
    console.log(chalk.cyan('\n🤖 GitHub Agent Orchestrator - Runner\n'));

    if (!this.running) {
      this.running = true;
      this.loadAndStartWorkers();
      
      // Reload workers periodically
      setInterval(() => {
        if (this.running) {
          this.loadAndStartWorkers();
        }
      }, 60000); // Every minute
    }
  }

  stop(): void {
    console.log(chalk.yellow('\n🛑 Stopping orchestrator runner...'));
    this.running = false;
    
    // Clear all timers
    for (const timer of this.pollTimers.values()) {
      clearInterval(timer);
    }
    this.pollTimers.clear();
    this.workers.clear();
  }

  private loadAndStartWorkers(): void {
    const repos = db.getEnabledRepos();
    const currentIds = new Set(this.workers.keys());
    const newIds = new Set(repos.map(r => r.id));

    // Stop workers for removed repos
    for (const repoId of currentIds) {
      if (!newIds.has(repoId)) {
        const timer = this.pollTimers.get(repoId);
        if (timer) {
          clearInterval(timer);
          this.pollTimers.delete(repoId);
        }
        this.workers.delete(repoId);
        console.log(`  Removed worker: ${repoId}`);
      }
    }

    // Start/update workers for enabled repos
    for (const repo of repos) {
      if (!this.workers.has(repo.id)) {
        this.startWorker(repo);
      }
    }
  }

  private async startWorker(repo: ManagedRepo): Promise<void> {
    console.log(chalk.blue(`  Starting worker for: ${repo.name} (${repo.githubRepo})`));

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      console.log(chalk.red(`    ✗ GITHUB_TOKEN not set`));
      return;
    }

    try {
      const client = new GitHubClient(token, repo.githubRepo, repo.localPath);
      const orchestrator = new IssueOrchestrator(client, false);
      const executor = new TaskExecutor(client);

      const worker: RepoWorker = {
        repoId: repo.id,
        repoName: repo.name,
        githubRepo: repo.githubRepo,
        localPath: repo.localPath,
        pollingInterval: repo.pollingInterval,
        labelFilter: repo.labelFilter.split(',').map(l => l.trim()),
        executor,
      };

      this.workers.set(repo.id, worker);

      // Start polling
      const timer = setInterval(() => {
        this.pollRepo(repo, client, orchestrator, executor);
      }, repo.pollingInterval * 1000);

      this.pollTimers.set(repo.id, timer);

      // Initial poll
      this.pollRepo(repo, client, orchestrator, executor);

      console.log(chalk.green(`    ✓ Worker started (polling every ${repo.pollingInterval}s)`));

    } catch (error: any) {
      console.log(chalk.red(`    ✗ Failed to start worker: ${error.message}`));
    }
  }

  private async pollRepo(
    repo: ManagedRepo,
    client: GitHubClient,
    orchestrator: IssueOrchestrator,
    executor: TaskExecutor
  ): Promise<void> {
    try {
      // Check for new issues with "ready" label
      const readyIssues = await client.getOpenIssues([config.labels.ready]);
      
      for (const issue of readyIssues) {
        console.log(chalk.cyan(`\n📬 [${repo.name}] New issue: #${issue.number}`));
        
        // Get issue with full context (including user responses if any)
        const issueWithContext = await executor.getIssueWithContext(issue.number);
        await this.processIssue(repo, issueWithContext || issue, client, orchestrator);
      }

      // Check for blocked issues that might have been answered
      const blockedIssues = await client.getOpenIssues([config.labels.blocked]);
      
      for (const issue of blockedIssues) {
        const userResponse = await executor.checkForUserResponse(issue.number);
        
        if (userResponse !== null) {
          console.log(chalk.cyan(`\n💬 [${repo.name}] User responded to blocked issue: #${issue.number}`));
          
          // Get issue with full context (body + user responses)
          const issueWithContext = await executor.getIssueWithContext(issue.number);
          
          // Remove blocked label and re-process with full context
          await client.removeLabel(issue.number, config.labels.blocked);
          await client.addLabels(issue.number, [config.labels.ready]);
          
          // Process immediately with full context
          if (issueWithContext) {
            await this.processIssue(repo, issueWithContext, client, orchestrator);
          }
        }
      }

    } catch (error: any) {
      console.log(chalk.red(`  ✗ [${repo.name}] Poll error: ${error.message}`));
    }
  }

  private async processIssue(
    repo: ManagedRepo,
    issue: any,
    client: GitHubClient,
    orchestrator: IssueOrchestrator
  ): Promise<void> {
    try {
      const result = await orchestrator.processIssue(issue);

      // Log the result
      const log: Omit<ProcessingLog, 'createdAt'> = {
        id: uuidv4(),
        repoId: repo.id,
        issueNumber: issue.number,
        status: result.success ? 'success' : (result.message.includes('clarification') ? 'blocked' : 'failed'),
        message: result.message,
      };
      db.addLog(log);

      if (result.success) {
        console.log(chalk.green(`  ✓ [${repo.name}] Issue #${issue.number} completed`));
      } else if (result.message.includes('clarification')) {
        console.log(chalk.yellow(`  ⏸ [${repo.name}] Issue #${issue.number} needs clarification`));
      } else {
        console.log(chalk.red(`  ✗ [${repo.name}] Issue #${issue.number} failed: ${result.message}`));
      }
    } catch (error: any) {
      console.log(chalk.red(`  ✗ [${repo.name}] Error processing #${issue.number}: ${error.message}`));
    }
  }

  getStatus(): { running: boolean; workers: number; repos: string[] } {
    return {
      running: this.running,
      workers: this.workers.size,
      repos: Array.from(this.workers.keys()),
    };
  }
}

// Singleton instance
export const runner = new OrchestratorRunner();
