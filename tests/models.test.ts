import { Issue, FileChange, PRResult, ProcessingResult, IssueStatus } from '../src/github/models';

describe('GitHub Models', () => {
  describe('Issue', () => {
    it('should create an issue with all required fields', () => {
      const issue: Issue = {
        number: 1,
        title: 'Test Issue',
        body: 'This is a test issue body',
        author: 'testuser',
        labels: ['bug', 'priority:high'],
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
        state: 'open',
        htmlUrl: 'https://github.com/owner/repo/issues/1',
        assignees: ['assignee1', 'assignee2'],
      };

      expect(issue.number).toBe(1);
      expect(issue.title).toBe('Test Issue');
      expect(issue.body).toBe('This is a test issue body');
      expect(issue.author).toBe('testuser');
      expect(issue.labels).toContain('bug');
      expect(issue.labels).toContain('priority:high');
      expect(issue.state).toBe('open');
      expect(issue.assignees).toHaveLength(2);
    });

    it('should support closed state', () => {
      const issue: Issue = {
        number: 2,
        title: 'Closed Issue',
        body: 'This issue is closed',
        author: 'testuser',
        labels: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        state: 'closed',
        htmlUrl: 'https://github.com/owner/repo/issues/2',
        assignees: [],
      };

      expect(issue.state).toBe('closed');
    });
  });

  describe('FileChange', () => {
    it('should create a file change with create operation', () => {
      const change: FileChange = {
        path: 'src/new-file.ts',
        content: 'console.log("hello")',
        operation: 'create',
      };

      expect(change.path).toBe('src/new-file.ts');
      expect(change.operation).toBe('create');
    });

    it('should create a file change with modify operation', () => {
      const change: FileChange = {
        path: 'src/existing.ts',
        content: 'modified content',
        operation: 'modify',
      };

      expect(change.operation).toBe('modify');
    });

    it('should create a file change with delete operation', () => {
      const change: FileChange = {
        path: 'src/to-delete.ts',
        content: '',
        operation: 'delete',
      };

      expect(change.operation).toBe('delete');
    });
  });

  describe('PRResult', () => {
    it('should create a successful PR result', () => {
      const result: PRResult = {
        success: true,
        prNumber: 42,
        prUrl: 'https://github.com/owner/repo/pull/42',
        branchName: 'feature/new-feature',
        message: 'PR created successfully',
      };

      expect(result.success).toBe(true);
      expect(result.prNumber).toBe(42);
      expect(result.prUrl).toBe('https://github.com/owner/repo/pull/42');
    });

    it('should create a failed PR result', () => {
      const result: PRResult = {
        success: false,
        message: 'Failed to create PR: branch already exists',
      };

      expect(result.success).toBe(false);
      expect(result.prNumber).toBeUndefined();
    });
  });

  describe('ProcessingResult', () => {
    it('should create a successful processing result', () => {
      const result: ProcessingResult = {
        issueNumber: 1,
        success: true,
        message: 'Issue processed successfully',
        changes: [
          { path: 'file1.ts', content: '', operation: 'create' },
        ],
        prResult: {
          success: true,
          prNumber: 10,
          message: 'PR created',
        },
        durationMs: 5000,
      };

      expect(result.success).toBe(true);
      expect(result.issueNumber).toBe(1);
      expect(result.changes).toHaveLength(1);
      expect(result.prResult?.prNumber).toBe(10);
    });

    it('should create a failed processing result', () => {
      const result: ProcessingResult = {
        issueNumber: 2,
        success: false,
        message: 'Processing failed',
        changes: [],
        error: 'OpenCode execution failed',
        durationMs: 1000,
      };

      expect(result.success).toBe(false);
      expect(result.error).toBe('OpenCode execution failed');
    });
  });

  describe('IssueStatus', () => {
    it('should have correct enum values', () => {
      expect(IssueStatus.NEW).toBe('new');
      expect(IssueStatus.IN_PROGRESS).toBe('in_progress');
      expect(IssueStatus.DONE).toBe('done');
      expect(IssueStatus.FAILED).toBe('failed');
      expect(IssueStatus.BLOCKED).toBe('blocked');
    });
  });
});