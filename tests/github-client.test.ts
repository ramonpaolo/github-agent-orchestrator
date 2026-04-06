import { GitHubClient } from '../src/github/client';
import { Issue } from '../src/github/models';

jest.mock('@octokit/rest', () => {
  const mockOctokit = {
    issues: {
      listForRepo: jest.fn(),
      get: jest.fn(),
      addLabels: jest.fn(),
      removeLabel: jest.fn(),
      createComment: jest.fn(),
      listComments: jest.fn(),
    },
    pulls: {
      create: jest.fn(),
    },
    repos: {
      getContent: jest.fn(),
      createOrUpdateFileContents: jest.fn(),
    },
    git: {
      getRef: jest.fn(),
      createRef: jest.fn(),
    },
  };
  return { Octokit: jest.fn(() => mockOctokit) };
});

jest.mock('simple-git', () => {
  return jest.fn(() => ({
    checkout: jest.fn(),
    checkoutLocalBranch: jest.fn(),
    add: jest.fn(),
    commit: jest.fn(),
    push: jest.fn(),
    pull: jest.fn(),
    fetch: jest.fn(),
    raw: jest.fn(),
    branchLocal: jest.fn(),
  }));
});

describe('GitHubClient', () => {
  let client: GitHubClient;
  const mockOctokit = new (require('@octokit/rest').Octokit)();

  beforeEach(() => {
    jest.clearAllMocks();
    client = new GitHubClient('test-token', 'owner/repo', '/tmp/repo');
  });

  describe('constructor', () => {
    it('should throw error for invalid repo format', () => {
      expect(() => new GitHubClient('token', 'invalid', '/tmp/repo')).toThrow(
        'Invalid repo format: invalid. Expected: owner/repo'
      );
    });

    it('should create client with valid repo format', () => {
      const validClient = new GitHubClient('token', 'owner/repo', '/tmp/repo');
      expect(validClient).toBeInstanceOf(GitHubClient);
    });
  });

  describe('getOpenIssues', () => {
    it('should return empty array when API fails', async () => {
      mockOctokit.issues.listForRepo.mockRejectedValue(new Error('API Error'));

      const issues = await client.getOpenIssues();

      expect(issues).toEqual([]);
    });

    it('should filter out pull requests from issues', async () => {
      mockOctokit.issues.listForRepo.mockResolvedValue({
        data: [
          {
            number: 1,
            title: 'Issue 1',
            body: 'Body 1',
            user: { login: 'user1' },
            labels: [],
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
            state: 'open',
            html_url: 'https://github.com/owner/repo/issues/1',
            assignees: [],
            pull_request: undefined,
          },
          {
            number: 2,
            title: 'PR 2',
            body: 'PR Body',
            user: { login: 'user2' },
            labels: [],
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
            state: 'open',
            html_url: 'https://github.com/owner/repo/pull/2',
            assignees: [],
            pull_request: {}, // This is a PR
          },
        ],
      });

      const issues = await client.getOpenIssues();

      expect(issues).toHaveLength(1);
      expect(issues[0].number).toBe(1);
    });

    it('should filter issues by labels', async () => {
      mockOctokit.issues.listForRepo.mockResolvedValue({
        data: [
          {
            number: 1,
            title: 'Issue 1',
            body: 'Body',
            user: { login: 'user' },
            labels: [{ name: 'bug' }, { name: 'priority:high' }],
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
            state: 'open',
            html_url: 'https://github.com/owner/repo/issues/1',
            assignees: [],
          },
        ],
      });

      const issues = await client.getOpenIssues(['bug']);

      expect(mockOctokit.issues.listForRepo).toHaveBeenCalledWith(
        expect.objectContaining({
          labels: 'bug',
        })
      );
    });
  });

  describe('getIssue', () => {
    it('should return null when issue not found', async () => {
      mockOctokit.issues.get.mockRejectedValue({ status: 404 });

      const issue = await client.getIssue(999);

      expect(issue).toBeNull();
    });

    it('should return issue when found', async () => {
      mockOctokit.issues.get.mockResolvedValue({
        data: {
          number: 1,
          title: 'Test Issue',
          body: 'Issue body',
          user: { login: 'testuser' },
          labels: [{ name: 'bug' }],
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z',
          state: 'open',
          html_url: 'https://github.com/owner/repo/issues/1',
          assignees: [{ login: 'assignee1' }],
        },
      });

      const issue = await client.getIssue(1);

      expect(issue).not.toBeNull();
      expect(issue?.number).toBe(1);
      expect(issue?.title).toBe('Test Issue');
      expect(issue?.author).toBe('testuser');
    });
  });

  describe('addLabels', () => {
    it('should return true on success', async () => {
      mockOctokit.issues.addLabels.mockResolvedValue({ status: 200 });

      const result = await client.addLabels(1, ['bug']);

      expect(result).toBe(true);
    });

    it('should return false on failure', async () => {
      mockOctokit.issues.addLabels.mockRejectedValue(new Error('Failed'));

      const result = await client.addLabels(1, ['bug']);

      expect(result).toBe(false);
    });
  });

  describe('removeLabel', () => {
    it('should return true on success', async () => {
      mockOctokit.issues.removeLabel.mockResolvedValue({ status: 200 });

      const result = await client.removeLabel(1, 'bug');

      expect(result).toBe(true);
    });

    it('should return false on failure', async () => {
      mockOctokit.issues.removeLabel.mockRejectedValue(new Error('Failed'));

      const result = await client.removeLabel(1, 'bug');

      expect(result).toBe(false);
    });
  });

  describe('addComment', () => {
    it('should return true on success', async () => {
      mockOctokit.issues.createComment.mockResolvedValue({ status: 201 });

      const result = await client.addComment(1, 'Test comment');

      expect(result).toBe(true);
    });

    it('should return false on failure', async () => {
      mockOctokit.issues.createComment.mockRejectedValue(new Error('Failed'));

      const result = await client.addComment(1, 'Test comment');

      expect(result).toBe(false);
    });
  });

  describe('getComments', () => {
    it('should return empty array when API fails', async () => {
      mockOctokit.issues.listComments.mockRejectedValue(new Error('API Error'));

      const comments = await client.getComments(1);

      expect(comments).toEqual([]);
    });

    it('should return mapped comments', async () => {
      mockOctokit.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 1,
            body: 'Comment 1',
            user: { login: 'user1' },
            created_at: '2024-01-01T00:00:00Z',
          },
          {
            id: 2,
            body: 'Comment 2',
            user: { login: 'user2' },
            created_at: '2024-01-02T00:00:00Z',
          },
        ],
      });

      const comments = await client.getComments(1);

      expect(comments).toHaveLength(2);
      expect(comments[0].body).toBe('Comment 1');
      expect(comments[1].user).toBe('user2');
    });
  });

  describe('createPullRequest', () => {
    it('should return success with PR data', async () => {
      mockOctokit.pulls.create.mockResolvedValue({
        data: {
          number: 42,
          html_url: 'https://github.com/owner/repo/pull/42',
        },
      });

      const result = await client.createPullRequest(
        'PR Title',
        'PR Body',
        'feature-branch',
        'main'
      );

      expect(result.success).toBe(true);
      expect(result.prNumber).toBe(42);
      expect(result.prUrl).toBe('https://github.com/owner/repo/pull/42');
    });

    it('should return failure on error', async () => {
      mockOctokit.pulls.create.mockRejectedValue(new Error('PR creation failed'));

      const result = await client.createPullRequest(
        'PR Title',
        'PR Body',
        'feature-branch',
        'main'
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe('PR creation failed');
    });
  });

  describe('getRepoPath', () => {
    it('should return the repo path', () => {
      const path = client.getRepoPath();
      expect(path).toBe('/tmp/repo');
    });
  });
});