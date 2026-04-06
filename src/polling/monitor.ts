import { Issue } from '../github';
import { GitHubClient } from '../github/client';

export interface MonitorConfig {
  pollingInterval: number; // seconds
  batchSize: number;
  labelFilter: string[];
  includeRecentHours: number;
}

export class IssueMonitor {
  private client: GitHubClient;
  private config: MonitorConfig;
  private running: boolean = false;
  private lastCheck: Date | null = null;
  private processedIssues: Set<number> = new Set();
  private intervalId: NodeJS.Timeout | null = null;

  constructor(client: GitHubClient, config?: Partial<MonitorConfig>) {
    this.client = client;
    this.config = {
      pollingInterval: config?.pollingInterval ?? 60,
      batchSize: config?.batchSize ?? 10,
      labelFilter: config?.labelFilter ?? ['agent:ready'],
      includeRecentHours: config?.includeRecentHours ?? 24,
    };
  }

  isRunning(): boolean {
    return this.running;
  }

  start(callback: (issue: Issue) => void | Promise<void>): void {
    if (this.running) {
      console.log('Monitor is already running');
      return;
    }

    this.running = true;
    console.log(`🕐 Issue monitor started (interval: ${this.config.pollingInterval}s)`);

    // Initial check
    this.pollOnce(callback);

    // Continuous polling
    this.intervalId = setInterval(() => {
      if (this.running) {
        this.pollOnce(callback);
      }
    }, this.config.pollingInterval * 1000);
  }

  stop(): void {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log('🛑 Issue monitor stopped');
  }

  markAsProcessed(issueNumber: number): void {
    this.processedIssues.add(issueNumber);
  }

  private async pollOnce(callback: (issue: Issue) => void | Promise<void>): Promise<void> {
    console.log(`⏰ Polling at ${new Date().toISOString()}`);

    try {
      const issues = await this.client.getOpenIssues(this.config.labelFilter);

      if (issues.length === 0) {
        console.log('  No new issues found');
        return;
      }

      // Filter out already processed issues
      let newIssues = issues.filter((issue) => !this.processedIssues.has(issue.number));

      // Filter by age if configured
      if (this.config.includeRecentHours > 0) {
        const cutoff = new Date(Date.now() - this.config.includeRecentHours * 60 * 60 * 1000);
        newIssues = newIssues.filter((issue) => issue.createdAt >= cutoff);
      }

      if (newIssues.length === 0) {
        console.log('  No new issues after filtering');
        return;
      }

      console.log(`📬 Found ${newIssues.length} new issue(s)`);

      for (const issue of newIssues.slice(0, this.config.batchSize)) {
        console.log(`  → #${issue.number}: ${issue.title}`);
        this.processedIssues.add(issue.number);

        try {
          await callback(issue);
        } catch (error) {
          console.error(`  ❌ Callback failed for issue #${issue.number}:`, error);
        }
      }

      this.lastCheck = new Date();
    } catch (error) {
      console.error('❌ Polling failed:', error);
    }
  }

  getStatus(): {
    running: boolean;
    lastCheck: string | null;
    processedCount: number;
    pollingInterval: number;
  } {
    return {
      running: this.running,
      lastCheck: this.lastCheck?.toISOString() ?? null,
      processedCount: this.processedIssues.size,
      pollingInterval: this.config.pollingInterval,
    };
  }
}
