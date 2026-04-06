import { IssueOrchestrator } from '../src/agent/orchestrator';
import { GitHubClient } from '../src/github/client';
import { Issue, FileChange } from '../src/github/models';

jest.mock('../src/github/client');
jest.mock('../src/opencode/client', () => ({
  getLogEmitter: () => ({ emit: jest.fn() }),
}));

jest.mock('../src/config', () => ({
  config: {
    labels: {
      ready: 'agent:ready',
      implementing: 'agent:implementing',
      done: 'agent:done',
      failed: 'agent:failed',
      blocked: 'agent:blocked',
    },
  },
}));

describe('IssueOrchestrator', () => {
  let orchestrator: IssueOrchestrator;
  let mockClient: jest.Mocked<GitHubClient>;

  const createMockIssue = (number: number, title: string, body: string): Issue => ({
    number,
    title,
    body,
    author: 'testuser',
    labels: ['agent:ready'],
    createdAt: new Date(),
    updatedAt: new Date(),
    state: 'open',
    htmlUrl: `https://github.com/owner/repo/issues/${number}`,
    assignees: [],
  });

  beforeEach(() => {
    jest.clearAllMocks();

    mockClient = {
      getOpenIssues: jest.fn(),
      getIssue: jest.fn(),
      addLabels: jest.fn(),
      removeLabel: jest.fn(),
      addComment: jest.fn(),
      createComment: jest.fn(),
      getComments: jest.fn(),
      getIssueUpdatedAt: jest.fn(),
      createBranch: jest.fn(),
      createOrUpdateFile: jest.fn(),
      createPullRequest: jest.fn(),
      gitCheckout: jest.fn(),
      switchToMainAndCreateBranch: jest.fn(),
      gitCommit: jest.fn(),
      gitPush: jest.fn(),
      gitPull: jest.fn(),
      getRepoPath: jest.fn().mockReturnValue('/tmp/repo'),
    } as any;

    orchestrator = new IssueOrchestrator(mockClient, false);
  });

  describe('constructor', () => {
    it('should create orchestrator with dryRun false by default', () => {
      const orchestratorDryRunFalse = new IssueOrchestrator(mockClient);
      expect(orchestratorDryRunFalse).toBeInstanceOf(IssueOrchestrator);
    });

    it('should create orchestrator with dryRun true', () => {
      const orchestratorDryRunTrue = new IssueOrchestrator(mockClient, true);
      expect(orchestratorDryRunTrue).toBeInstanceOf(IssueOrchestrator);
    });
  });

  describe('processIssue', () => {
    it('should process issue successfully and create PR', async () => {
      const issue = createMockIssue(1, 'Fix bug', 'Fix the login bug');

      mockClient.removeLabel.mockResolvedValue(true);
      mockClient.addLabels.mockResolvedValue(true);
      mockClient.addComment.mockResolvedValue(true);
      mockClient.gitCheckout.mockResolvedValue(true);
      mockClient.createBranch.mockResolvedValue(true);
      mockClient.gitPush.mockResolvedValue(true);
      mockClient.createPullRequest.mockResolvedValue({
        success: true,
        prNumber: 42,
        prUrl: 'https://github.com/owner/repo/pull/42',
        branchName: 'fix/1-ai-fix-bug',
        message: 'PR created',
      });

      const mockExecutor = (orchestrator as any).executor;
      mockExecutor.execute = jest.fn().mockResolvedValue({
        changes: [{ path: 'src/auth.ts', content: '', operation: 'modify' }],
        branchName: 'fix/1-ai-fix-bug',
        error: null,
        status: 'executed',
      });

      const result = await orchestrator.processIssue(issue);

      expect(result.success).toBe(true);
      expect(result.issueNumber).toBe(1);
    });

    it('should handle dry run mode', async () => {
      const dryRunOrchestrator = new IssueOrchestrator(mockClient, true);
      const issue = createMockIssue(1, 'Fix bug', 'Fix the login bug');

      const mockExecutor = (dryRunOrchestrator as any).executor;
      mockExecutor.execute = jest.fn().mockResolvedValue({
        changes: [{ path: 'src/auth.ts', content: '', operation: 'modify' }],
        branchName: 'fix/1-ai-fix-bug',
        error: null,
        status: 'executed',
      });

      const result = await dryRunOrchestrator.processIssue(issue);

      expect(mockClient.gitCheckout).not.toHaveBeenCalled();
      expect(mockClient.createBranch).not.toHaveBeenCalled();
    });

    it('should return failure when no changes made', async () => {
      const issue = createMockIssue(1, 'Fix bug', 'Fix the login bug');

      const mockExecutor = (orchestrator as any).executor;
      mockExecutor.execute = jest.fn().mockResolvedValue({
        changes: [],
        branchName: null,
        error: null,
        status: 'executed',
      });

      const result = await orchestrator.processIssue(issue);

      expect(result.success).toBe(false);
      expect(result.message).toContain('No changes');
    });

    it('should handle executor error', async () => {
      const issue = createMockIssue(1, 'Fix bug', 'Fix the login bug');

      const mockExecutor = (orchestrator as any).executor;
      mockExecutor.execute = jest.fn().mockResolvedValue({
        changes: [],
        branchName: null,
        error: 'OpenCode execution failed',
        status: 'error',
      });

      const result = await orchestrator.processIssue(issue);

      expect(result.success).toBe(false);
      expect(result.error).toBe('OpenCode execution failed');
    });
  });

  describe('getStats', () => {
    it('should return initial stats', () => {
      const stats = orchestrator.getStats();

      expect(stats.processed).toBe(0);
      expect(stats.successful).toBe(0);
      expect(stats.failed).toBe(0);
    });

    it('should calculate success rate correctly', () => {
      const stats = orchestrator.getStats();

      expect(stats.successRate).toBe('N/A');
    });
  });
});