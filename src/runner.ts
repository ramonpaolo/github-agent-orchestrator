import { GitHubClient } from './github/client';
import { IssueMonitor, MonitorConfig } from './polling/monitor';
import { IssueOrchestrator } from './agent/orchestrator';
import { db, ManagedRepo, ProcessingLog } from './web/database';
import { v4 as uuidv4 } from 'uuid';
import chalk from 'chalk';

interface RepoWorker {
  repoId: string;
  monitor: IssueMonitor;
  orchestrator: IssueOrchestrator;
  client: GitHubClient;
}

export class OrchestratorRunner {
  private workers: Map<string, RepoWorker> = new Map();
  private running: boolean = false;

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
    
    for (const [repoId, worker] of this.workers) {
      worker.monitor.stop();
      console.log(`  Stopped worker for: ${repoId}`);
    }
    
    this.workers.clear();
  }

  private loadAndStartWorkers(): void {
    const repos = db.getEnabledRepos();
    const currentIds = new Set(this.workers.keys());
    const newIds = new Set(repos.map(r => r.id));

    // Stop workers for removed repos
    for (const repoId of currentIds) {
      if (!newIds.has(repoId)) {
        const worker = this.workers.get(repoId);
        if (worker) {
          worker.monitor.stop();
          this.workers.delete(repoId);
          console.log(`  Removed worker: ${repoId}`);
        }
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

    try {
      const token = process.env.GITHUB_TOKEN;
      if (!token) {
        console.log(chalk.red(`    ✗ GITHUB_TOKEN not set`));
        return;
      }

      const client = new GitHubClient(token, repo.githubRepo, repo.localPath);
      const orchestrator = new IssueOrchestrator(client, false);

      const monitorConfig: MonitorConfig = {
        pollingInterval: repo.pollingInterval,
        batchSize: 5,
        labelFilter: repo.labelFilter.split(',').map(l => l.trim()),
        includeRecentHours: 24,
      };

      const monitor = new IssueMonitor(client, monitorConfig);

      // Handle new issues
      monitor.start(async (issue) => {
        console.log(chalk.cyan(`\n📬 [${repo.name}] New issue detected: #${issue.number}`));
        
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
        } else {
          console.log(chalk.red(`  ✗ [${repo.name}] Issue #${issue.number} failed: ${result.message}`));
        }
      });

      this.workers.set(repo.id, { repoId: repo.id, monitor, orchestrator, client });
      console.log(chalk.green(`    ✓ Worker started (polling every ${repo.pollingInterval}s)`));

    } catch (error: any) {
      console.log(chalk.red(`    ✗ Failed to start worker: ${error.message}`));
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
