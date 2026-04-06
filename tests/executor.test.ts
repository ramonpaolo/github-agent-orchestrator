import { TaskExecutor, ExecutionStatus } from '../src/agent/executor';
import { GitHubClient } from '../src/github/client';
import { Issue } from '../src/github/models';

jest.mock('../src/github/client');
jest.mock('../src/opencode', () => ({
  runOpenCodeForIssue: jest.fn(),
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

describe('TaskExecutor', () => {
  let executor: TaskExecutor;
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

    executor = new TaskExecutor(mockClient);
  });

  describe('analyzeIssue (via execute)', () => {
    it('should identify bug fix task type', async () => {
      const issue = createMockIssue(
        1,
        'Bug: Login fails',
        'The login button does not work when clicked'
      );

      (require('../src/opencode').runOpenCodeForIssue as jest.Mock).mockResolvedValue({
        success: false,
        error: 'OpenCode not configured',
        changedFiles: [],
      });

      const result = await executor.execute(issue, true);

      expect(result.status).toBe(ExecutionStatus.CAN_EXECUTE);
    });

    it('should identify feature request task type', async () => {
      const issue = createMockIssue(
        2,
        'Feature: Add dark mode',
        'I would like to add a dark mode to the application'
      );

      (require('../src/opencode').runOpenCodeForIssue as jest.Mock).mockResolvedValue({
        success: false,
        error: 'OpenCode not configured',
        changedFiles: [],
      });

      const result = await executor.execute(issue, true);

      expect(result.status).toBe(ExecutionStatus.CAN_EXECUTE);
    });

    it('should identify documentation task type', async () => {
      const issue = createMockIssue(
        3,
        'Docs: Update README',
        'The README needs to be updated with new instructions'
      );

      (require('../src/opencode').runOpenCodeForIssue as jest.Mock).mockResolvedValue({
        success: false,
        error: 'OpenCode not configured',
        changedFiles: [],
      });

      const result = await executor.execute(issue, true);

      expect(result.status).toBe(ExecutionStatus.CAN_EXECUTE);
    });

    it('should identify refactor task type', async () => {
      const issue = createMockIssue(
        4,
        'Refactor: Clean up utils',
        'The utils folder needs to be restructured for better organization'
      );

      (require('../src/opencode').runOpenCodeForIssue as jest.Mock).mockResolvedValue({
        success: false,
        error: 'OpenCode not configured',
        changedFiles: [],
      });

      const result = await executor.execute(issue, true);

      expect(result.status).toBe(ExecutionStatus.CAN_EXECUTE);
    });
  });

  describe('execute', () => {
    it('should return executed status when OpenCode succeeds', async () => {
      const issue = createMockIssue(1, 'Fix bug', 'Fix the login bug in src/auth.ts');

      (require('../src/opencode').runOpenCodeForIssue as jest.Mock).mockResolvedValue({
        success: true,
        changedFiles: ['src/auth.ts'],
        error: undefined,
      });

      const result = await executor.execute(issue, false);

      expect(result.status).toBe(ExecutionStatus.EXECUTED);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].path).toBe('src/auth.ts');
    });

    it('should return error when OpenCode fails', async () => {
      const issue = createMockIssue(1, 'Fix bug', 'Fix the login bug');

      (require('../src/opencode').runOpenCodeForIssue as jest.Mock).mockResolvedValue({
        success: false,
        error: 'OpenCode execution failed',
        changedFiles: [],
      });

      const result = await executor.execute(issue, false);

      expect(result.status).toBe(ExecutionStatus.CAN_EXECUTE);
      expect(result.error).toBe('OpenCode execution failed');
    });

    it('should return error when no files are changed', async () => {
      const issue = createMockIssue(1, 'Fix bug', 'Fix the login bug');

      (require('../src/opencode').runOpenCodeForIssue as jest.Mock).mockResolvedValue({
        success: true,
        changedFiles: [],
        error: undefined,
      });

      const result = await executor.execute(issue, false);

      expect(result.status).toBe(ExecutionStatus.CAN_EXECUTE);
      expect(result.error).toContain('no file changes');
    });
  });

  describe('checkForUserResponse', () => {
    it('should return null when no comments exist', async () => {
      mockClient.getComments.mockResolvedValue([]);

      const response = await executor.checkForUserResponse(1);

      expect(response).toBeNull();
    });

    it('should return null when no newer comments after our clarification', async () => {
      const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      mockClient.getComments.mockResolvedValue([
        {
          id: 1,
          body: '🤖 **Agent Clarification Needed**\n\nSome question?',
          user: 'github-actions[bot]',
          createdAt: oldDate,
        },
      ]);
      mockClient.getIssueUpdatedAt.mockResolvedValue(oldDate);

      const response = await executor.checkForUserResponse(1);

      expect(response).toBeNull();
    });

    it('should return user response when newer comment exists', async () => {
      const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const newDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

      mockClient.getComments.mockResolvedValue([
        {
          id: 1,
          body: '🤖 **Agent Clarification Needed**\n\nSome question?',
          user: 'github-actions[bot]',
          createdAt: oldDate,
        },
        {
          id: 2,
          body: 'Here is the additional context you requested',
          user: 'realuser',
          createdAt: newDate,
        },
      ]);

      const response = await executor.checkForUserResponse(1);

      expect(response).toContain('Here is the additional context you requested');
    });
  });
});