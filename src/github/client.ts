import { Octokit } from '@octokit/rest';
import simpleGit, { SimpleGit } from 'simple-git';
import { Issue, FileChange, PRResult } from './models';

export class GitHubClient {
  private octokit: Octokit;
  private repoOwner: string;
  private repoName: string;
  private repoPath: string;
  private git: SimpleGit;

  constructor(token: string, repo: string, repoPath: string) {
    const [owner, name] = repo.split('/');

    if (!owner || !name) {
      throw new Error(`Invalid repo format: ${repo}. Expected: owner/repo`);
    }

    this.octokit = new Octokit({ auth: token });
    this.repoOwner = owner;
    this.repoName = name;
    this.repoPath = repoPath;
    this.git = simpleGit(repoPath);
  }

  async getOpenIssues(labels?: string[]): Promise<Issue[]> {
    try {
      const params: any = {
        owner: this.repoOwner,
        repo: this.repoName,
        state: 'open',
        per_page: 100,
      };

      if (labels && labels.length > 0) {
        params.labels = labels.join(',');
      }

      const { data } = await this.octokit.issues.listForRepo(params);

      return data
        .filter((issue) => !issue.pull_request) // Filter out PRs
        .map((issue) => ({
          number: issue.number,
          title: issue.title,
          body: issue.body || '',
          author: issue.user?.login || 'unknown',
          labels: issue.labels?.map((l) => (typeof l === 'string' ? l : l.name)).filter((l): l is string => l !== undefined) || [],
          createdAt: new Date(issue.created_at),
          updatedAt: new Date(issue.updated_at),
          state: issue.state as 'open' | 'closed',
          htmlUrl: issue.html_url,
          assignees: issue.assignees?.map((a) => a.login) || [],
        }));
    } catch (error) {
      console.error('Failed to fetch issues:', error);
      return [];
    }
  }

  async getIssue(issueNumber: number): Promise<Issue | null> {
    try {
      const { data } = await this.octokit.issues.get({
        owner: this.repoOwner,
        repo: this.repoName,
        issue_number: issueNumber,
      });

      return {
        number: data.number,
        title: data.title,
        body: data.body || '',
        author: data.user?.login || 'unknown',
        labels: data.labels?.map((l) => (typeof l === 'string' ? l : l.name)).filter((l): l is string => l !== undefined) || [],
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at),
        state: data.state as 'open' | 'closed',
        htmlUrl: data.html_url,
        assignees: data.assignees?.map((a) => a.login) || [],
      };
    } catch (error) {
      console.error(`Failed to fetch issue #${issueNumber}:`, error);
      return null;
    }
  }

  async addLabels(issueNumber: number, labels: string[]): Promise<boolean> {
    try {
      await this.octokit.issues.addLabels({
        owner: this.repoOwner,
        repo: this.repoName,
        issue_number: issueNumber,
        labels,
      });
      return true;
    } catch (error) {
      console.error(`Failed to add labels to issue #${issueNumber}:`, error);
      return false;
    }
  }

  async removeLabel(issueNumber: number, label: string): Promise<boolean> {
    try {
      await this.octokit.issues.removeLabel({
        owner: this.repoOwner,
        repo: this.repoName,
        issue_number: issueNumber,
        name: label,
      });
      return true;
    } catch (error) {
      console.error(`Failed to remove label from issue #${issueNumber}:`, error);
      return false;
    }
  }

  async addComment(issueNumber: number, body: string): Promise<boolean> {
    try {
      await this.octokit.issues.createComment({
        owner: this.repoOwner,
        repo: this.repoName,
        issue_number: issueNumber,
        body,
      });
      return true;
    } catch (error) {
      console.error(`Failed to add comment to issue #${issueNumber}:`, error);
      return false;
    }
  }

  async createIssue(title: string, body: string, labels?: string[]): Promise<number | null> {
    try {
      const { data } = await this.octokit.issues.create({
        owner: this.repoOwner,
        repo: this.repoName,
        title,
        body,
        labels,
      });
      return data.number;
    } catch (error) {
      console.error(`Failed to create issue "${title}":`, error);
      return null;
    }
  }

  async getComments(issueNumber: number): Promise<Array<{ id: number; body: string; user: string; createdAt: string }>> {
    try {
      const { data } = await this.octokit.issues.listComments({
        owner: this.repoOwner,
        repo: this.repoName,
        issue_number: issueNumber,
        per_page: 100,
      });

      return data.map(comment => ({
        id: comment.id,
        body: comment.body || '',
        user: comment.user?.login || 'unknown',
        createdAt: comment.created_at,
      }));
    } catch (error) {
      console.error(`Failed to get comments for issue #${issueNumber}:`, error);
      return [];
    }
  }

  async getIssueUpdatedAt(issueNumber: number): Promise<string | null> {
    try {
      const { data } = await this.octokit.issues.get({
        owner: this.repoOwner,
        repo: this.repoName,
        issue_number: issueNumber,
      });
      return data.updated_at;
    } catch (error) {
      return null;
    }
  }

  async createBranch(branchName: string, baseBranch: string = 'main'): Promise<boolean> {
    try {
      const { data } = await this.octokit.git.getRef({
        owner: this.repoOwner,
        repo: this.repoName,
        ref: `heads/${baseBranch}`,
      });

      await this.octokit.git.createRef({
        owner: this.repoOwner,
        repo: this.repoName,
        ref: `refs/heads/${branchName}`,
        sha: data.object.sha,
      });

      return true;
    } catch (error) {
      console.error(`Failed to create branch ${branchName}:`, error);
      return false;
    }
  }

  async createOrUpdateFile(
    path: string,
    content: string,
    message: string,
    branch: string
  ): Promise<PRResult> {
    try {
      let sha: string | undefined;

      try {
        const { data } = await this.octokit.repos.getContent({
          owner: this.repoOwner,
          repo: this.repoName,
          path,
          ref: branch,
        });

        if (!Array.isArray(data) && 'sha' in data) {
          sha = data.sha;
        }
      } catch {
        // File doesn't exist, will create new
      }

      await this.octokit.repos.createOrUpdateFileContents({
        owner: this.repoOwner,
        repo: this.repoName,
        path,
        message,
        content: Buffer.from(content).toString('base64'),
        branch,
        sha,
      });

      return { success: true, branchName: branch, message: `File ${path} updated` };
    } catch (error: any) {
      console.error(`Failed to create/update file ${path}:`, error);
      return { success: false, message: error.message };
    }
  }

  async createPullRequest(
    title: string,
    body: string,
    head: string,
    base: string = 'main'
  ): Promise<PRResult> {
    try {
      const { data } = await this.octokit.pulls.create({
        owner: this.repoOwner,
        repo: this.repoName,
        title,
        body,
        head,
        base,
      });

      return {
        success: true,
        prNumber: data.number,
        prUrl: data.html_url,
        branchName: head,
        message: 'PR created successfully',
      };
    } catch (error: any) {
      console.error('Failed to create PR:', error);
      return { success: false, message: error.message };
    }
  }

  // Local git operations
  async gitCheckout(branch: string): Promise<boolean> {
    try {
      // First try to checkout existing branch
      try {
        await this.git.checkout(branch);
        return true;
      } catch {
        // If checkout fails, try to create new branch
        await this.git.checkoutLocalBranch(branch);
        return true;
      }
    } catch (error) {
      console.error(`Failed to checkout/create branch ${branch}:`, error);
      return false;
    }
  }

  /**
   * Switch to main branch and pull latest changes, then create a new branch from it.
   * This ensures every new branch is created from the latest main.
   * If the branch already exists locally, it will be deleted first.
   */
  async switchToMainAndCreateBranch(newBranch: string, baseBranch: string = 'main'): Promise<boolean> {
    try {
      console.log(`🔄 Switching to ${baseBranch} and pulling latest...`);
      
      // Fetch latest from remote
      await this.git.fetch('origin');
      
      // Checkout main (or base branch)
      await this.git.checkout(baseBranch);
      
      // Pull latest changes
      await this.git.pull('origin', baseBranch);
      
      // Delete local branch if it already exists (for retry scenarios)
      const branches = await this.git.branchLocal();
      if (branches.all.includes(newBranch)) {
        console.log(`🗑️ Branch '${newBranch}' already exists locally, deleting it first...`);
        await this.git.raw(['branch', '-D', newBranch]);
      }
      
      // Also try to delete remote branch if it exists
      try {
        await this.git.raw(['push', 'origin', '--delete', newBranch]);
        console.log(`🗑️ Deleted remote branch '${newBranch}'`);
      } catch {
        // Branch doesn't exist on remote, that's fine
      }
      
      // Create and switch to new branch
      await this.git.checkoutLocalBranch(newBranch);
      
      console.log(`✅ Created branch '${newBranch}' from latest '${baseBranch}'`);
      return true;
    } catch (error) {
      console.error(`Failed to create branch ${newBranch} from ${baseBranch}:`, error);
      return false;
    }
  }

  async gitCommit(message: string): Promise<boolean> {
    try {
      await this.git.add('.');
      await this.git.commit(message);
      return true;
    } catch (error) {
      console.error('Failed to commit:', error);
      return false;
    }
  }

  async gitPush(branch: string): Promise<boolean> {
    try {
      await this.git.push(['-u', 'origin', branch]);
      return true;
    } catch (error) {
      console.error(`Failed to push branch ${branch}:`, error);
      return false;
    }
  }

  async gitPull(): Promise<boolean> {
    try {
      await this.git.pull('origin', 'main');
      return true;
    } catch (error) {
      console.error('Failed to pull:', error);
      return false;
    }
  }

  getRepoPath(): string {
    return this.repoPath;
  }
}
