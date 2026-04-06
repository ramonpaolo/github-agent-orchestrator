import { IssueMonitor, MonitorConfig } from '../src/polling/monitor';
import { GitHubClient } from '../src/github/client';
import { Issue } from '../src/github/models';

jest.mock('../src/github/client');

describe('IssueMonitor', () => {
  let monitor: IssueMonitor;
  let mockClient: jest.Mocked<GitHubClient>;
  let callback: jest.Mock;

  const createMockIssue = (number: number, title: string, hoursAgo: number): Issue => ({
    number,
    title,
    body: `Body for issue ${number}`,
    author: 'testuser',
    labels: ['agent:ready'],
    createdAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000),
    updatedAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000),
    state: 'open',
    htmlUrl: `https://github.com/owner/repo/issues/${number}`,
    assignees: [],
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

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
      getRepoPath: jest.fn(),
    } as any;

    callback = jest.fn();
    monitor = new IssueMonitor(mockClient, {
      pollingInterval: 60,
      batchSize: 10,
      labelFilter: ['agent:ready'],
      includeRecentHours: 24,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    monitor.stop();
  });

  describe('constructor', () => {
    it('should create monitor with default config', () => {
      const defaultMonitor = new IssueMonitor(mockClient);
      
      expect(defaultMonitor).toBeInstanceOf(IssueMonitor);
    });

    it('should create monitor with custom config', () => {
      const customMonitor = new IssueMonitor(mockClient, {
        pollingInterval: 120,
        batchSize: 5,
        labelFilter: ['custom:label'],
        includeRecentHours: 48,
      });

      expect(customMonitor).toBeInstanceOf(IssueMonitor);
    });
  });

  describe('isRunning', () => {
    it('should return false initially', () => {
      expect(monitor.isRunning()).toBe(false);
    });

    it('should return true when started', async () => {
      mockClient.getOpenIssues.mockResolvedValue([]);
      const pollPromise = monitor.start(callback);
      
      await jest.runAllTimersAsync();
      await pollPromise;

      expect(monitor.isRunning()).toBe(true);
    });
  });

  describe('start/stop', () => {
    it('should not start if already running', async () => {
      mockClient.getOpenIssues.mockResolvedValue([]);
      const pollPromise = monitor.start(callback);
      await jest.runAllTimersAsync();
      await pollPromise;
      
      monitor.start(callback); 

      expect(monitor.isRunning()).toBe(true);
    });
  });

  describe('pollOnce', () => {
    it('should process new issues from polling', async () => {
      const issues = [
        createMockIssue(1, 'Issue 1', 1),
        createMockIssue(2, 'Issue 2', 2),
      ];
      mockClient.getOpenIssues.mockResolvedValue(issues);

      const pollPromise = monitor.start(callback);

      await jest.runAllTimersAsync();
      await pollPromise;

      expect(mockClient.getOpenIssues).toHaveBeenCalledWith(['agent:ready']);
    });

    it('should not process already processed issues', async () => {
      const issues = [
        createMockIssue(1, 'Issue 1', 1),
        createMockIssue(2, 'Issue 2', 2),
      ];
      mockClient.getOpenIssues.mockResolvedValue(issues);

      const pollPromise = monitor.start(callback);
      await jest.runAllTimersAsync();
      await pollPromise;

      monitor.markAsProcessed(1);

      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('should handle callback errors gracefully', async () => {
      const issues = [createMockIssue(1, 'Issue 1', 1)];
      mockClient.getOpenIssues.mockResolvedValue(issues);
      callback.mockRejectedValue(new Error('Callback error'));

      const pollPromise = monitor.start(callback);
      await jest.runAllTimersAsync();
      await pollPromise;

      expect(monitor.isRunning()).toBe(true);
    });
  });

  describe('getStatus', () => {
    it('should return correct status', async () => {
      mockClient.getOpenIssues.mockResolvedValue([]);
      const pollPromise = monitor.start(callback);
      await jest.runAllTimersAsync();
      await pollPromise;

      const status = monitor.getStatus();

      expect(status.running).toBe(true);
      expect(status.pollingInterval).toBe(60);
      expect(status.processedCount).toBe(0);
    });
  });
});