import Database from 'better-sqlite3';

const mockStmt = {
  all: jest.fn().mockReturnValue([]),
  get: jest.fn().mockReturnValue(null),
  run: jest.fn().mockReturnValue({ changes: 1 }),
};

const mockDb = {
  exec: jest.fn(),
  prepare: jest.fn().mockReturnValue(mockStmt),
  close: jest.fn(),
};

jest.mock('better-sqlite3', () => {
  return jest.fn(() => mockDb);
});

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
}));

jest.mock('path', () => ({
  join: jest.fn().mockReturnValue('/mock/path'),
}));

describe('DatabaseManager', () => {
  let db: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStmt.all.mockReturnValue([]);
    mockStmt.get.mockReturnValue(null);
    mockStmt.run.mockReturnValue({ changes: 1 });
    mockDb.prepare.mockReturnValue(mockStmt);

    jest.resetModules();
    db = require('../src/web/database').db;
  });

  afterEach(() => {
    if (db && db.close) {
      db.close();
    }
  });

  describe('repo operations', () => {
    const mockRepo = {
      id: 'test-id',
      name: 'Test Repo',
      localPath: '/tmp/repo',
      githubRepo: 'owner/repo',
      pollingInterval: 60,
      enabled: true,
      labelFilter: 'agent:ready',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    describe('getAllRepos', () => {
      it('should return empty array when no repos exist', () => {
        mockStmt.all.mockReturnValue([]);

        const repos = db.getAllRepos();

        expect(repos).toEqual([]);
        expect(mockDb.prepare).toHaveBeenCalledWith('SELECT * FROM repos ORDER BY createdAt DESC');
      });

      it('should return repos with enabled as boolean', () => {
        mockStmt.all.mockReturnValue([{ ...mockRepo, enabled: 1 }]);

        const repos = db.getAllRepos();

        expect(repos).toHaveLength(1);
        expect(repos[0].enabled).toBe(true);
      });
    });

    describe('getRepo', () => {
      it('should return null when repo not found', () => {
        mockStmt.get.mockReturnValue(null);

        const repo = db.getRepo('non-existent');

        expect(repo).toBeNull();
      });

      it('should return repo when found', () => {
        mockStmt.get.mockReturnValue({ ...mockRepo, enabled: 1 });

        const repo = db.getRepo('test-id');

        expect(repo).not.toBeNull();
        expect(repo?.id).toBe('test-id');
      });
    });

    describe('getEnabledRepos', () => {
      it('should return only enabled repos', () => {
        mockStmt.all.mockReturnValue([{ ...mockRepo, enabled: 1 }]);

        const repos = db.getEnabledRepos();

        expect(repos).toHaveLength(1);
        expect(repos[0].enabled).toBe(true);
        expect(mockDb.prepare).toHaveBeenCalledWith('SELECT * FROM repos WHERE enabled = 1');
      });
    });

    describe('addRepo', () => {
      it('should add a new repo', () => {
        const newRepo = {
          id: 'new-id',
          name: 'New Repo',
          localPath: '/tmp/new-repo',
          githubRepo: 'owner/new-repo',
          pollingInterval: 30,
          enabled: true,
          labelFilter: 'bug',
        };

        const result = db.addRepo(newRepo);

        expect(result.id).toBe('new-id');
        expect(result.name).toBe('New Repo');
        expect(mockStmt.run).toHaveBeenCalled();
      });
    });

    describe('updateRepo', () => {
      it('should return false when repo not found', () => {
        mockStmt.get.mockReturnValue(null);

        const result = db.updateRepo('non-existent', { name: 'Updated' });

        expect(result).toBe(false);
      });

      it('should update repo when found', () => {
        mockStmt.get.mockReturnValue({ ...mockRepo, enabled: 1 });

        const result = db.updateRepo('test-id', { name: 'Updated Name' });

        expect(result).toBe(true);
        expect(mockStmt.run).toHaveBeenCalled();
      });
    });

    describe('deleteRepo', () => {
      it('should return true when repo deleted', () => {
        mockStmt.run.mockReturnValue({ changes: 1 });

        const result = db.deleteRepo('test-id');

        expect(result).toBe(true);
      });

      it('should return false when repo not found', () => {
        mockStmt.run.mockReturnValue({ changes: 0 });

        const result = db.deleteRepo('non-existent');

        expect(result).toBe(false);
      });
    });
  });

  describe('task operations', () => {
    const mockTask = {
      id: 'task-1',
      repoId: 'repo-1',
      title: 'Test Task',
      description: 'Task description',
      internalDescription: '',
      status: 'backlog' as const,
      priority: 'medium' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    describe('getAllTasks', () => {
      it('should return empty array when no tasks', () => {
        mockStmt.all.mockReturnValue([]);

        const tasks = db.getAllTasks();

        expect(tasks).toEqual([]);
      });

      it('should return all tasks', () => {
        mockStmt.all.mockReturnValue([mockTask]);

        const tasks = db.getAllTasks();

        expect(tasks).toHaveLength(1);
      });
    });

    describe('getTask', () => {
      it('should return null when task not found', () => {
        mockStmt.get.mockReturnValue(null);

        const task = db.getTask('non-existent');

        expect(task).toBeNull();
      });

      it('should return task when found', () => {
        mockStmt.get.mockReturnValue(mockTask);

        const task = db.getTask('task-1');

        expect(task).not.toBeNull();
        expect(task?.title).toBe('Test Task');
      });
    });

    describe('getTasksByRepo', () => {
      it('should return tasks for a repo', () => {
        mockStmt.all.mockReturnValue([mockTask]);

        const tasks = db.getTasksByRepo('repo-1');

        expect(tasks).toHaveLength(1);
        expect(mockDb.prepare).toHaveBeenCalledWith(
          'SELECT * FROM tasks WHERE repoId = ? ORDER BY createdAt DESC'
        );
      });
    });

    describe('getTasksByStatus', () => {
      it('should return tasks with specific status', () => {
        mockStmt.all.mockReturnValue([mockTask]);

        const tasks = db.getTasksByStatus('backlog');

        expect(tasks).toHaveLength(1);
        expect(mockDb.prepare).toHaveBeenCalledWith(
          'SELECT * FROM tasks WHERE status = ? ORDER BY createdAt DESC'
        );
      });
    });

    describe('addTask', () => {
      it('should add a new task', () => {
        const newTask = {
          id: 'new-task',
          repoId: 'repo-1',
          title: 'New Task',
          description: 'Description',
          internalDescription: '',
          status: 'backlog' as const,
          priority: 'high' as const,
        };

        const result = db.addTask(newTask);

        expect(result.id).toBe('new-task');
        expect(result.title).toBe('New Task');
        expect(mockStmt.run).toHaveBeenCalled();
      });
    });

    describe('updateTask', () => {
      it('should return false when task not found', () => {
        mockStmt.get.mockReturnValue(null);

        const result = db.updateTask('non-existent', { title: 'Updated' });

        expect(result).toBe(false);
      });

      it('should update task when found', () => {
        mockStmt.get.mockReturnValue(mockTask);

        const result = db.updateTask('task-1', { title: 'Updated Title' });

        expect(result).toBe(true);
      });
    });

    describe('moveTask', () => {
      it('should return false when task not found', () => {
        mockStmt.get.mockReturnValue(null);

        const result = db.moveTask('non-existent', 'todo');

        expect(result).toBe(false);
      });

      it('should move task to new status', () => {
        mockStmt.get.mockReturnValue(mockTask);

        const result = db.moveTask('task-1', 'todo');

        expect(result).toBe(true);
      });
    });

    describe('deleteTask', () => {
      it('should return true when task deleted', () => {
        mockStmt.run.mockReturnValue({ changes: 1 });

        const result = db.deleteTask('task-1');

        expect(result).toBe(true);
      });

      it('should return false when task not found', () => {
        mockStmt.run.mockReturnValue({ changes: 0 });

        const result = db.deleteTask('non-existent');

        expect(result).toBe(false);
      });
    });
  });

  describe('processing logs', () => {
    const mockLog = {
      id: 'log-1',
      repoId: 'repo-1',
      issueNumber: 1,
      status: 'success' as const,
      message: 'Completed',
      createdAt: new Date().toISOString(),
    };

    describe('addLog', () => {
      it('should add a processing log', () => {
        const newLog = {
          id: 'new-log',
          repoId: 'repo-1',
          issueNumber: 2,
          status: 'success' as const,
          message: 'New log',
        };

        db.addLog(newLog);

        expect(mockStmt.run).toHaveBeenCalled();
      });
    });

    describe('getLogsForRepo', () => {
      it('should return logs for a repo', () => {
        mockStmt.all.mockReturnValue([mockLog]);

        const logs = db.getLogsForRepo('repo-1', 50);

        expect(logs).toHaveLength(1);
        expect(mockDb.prepare).toHaveBeenCalled();
      });
    });

    describe('getRecentLogs', () => {
      it('should return recent logs with repo name', () => {
        mockStmt.all.mockReturnValue([{ ...mockLog, repoName: 'Test Repo' }]);

        const logs = db.getRecentLogs(100);

        expect(logs).toHaveLength(1);
        expect(logs[0].repoName).toBe('Test Repo');
      });
    });
  });

  describe('stats', () => {
    describe('getRepoStats', () => {
      it('should return repo statistics', () => {
        mockStmt.get.mockReturnValue({
          total: 10,
          success: 7,
          failed: 2,
          blocked: 1,
        });

        const stats = db.getRepoStats('repo-1');

        expect(stats.processed).toBe(10);
        expect(stats.success).toBe(7);
        expect(stats.failed).toBe(2);
        expect(stats.blocked).toBe(1);
      });

      it('should return zeros when no data', () => {
        mockStmt.get.mockReturnValue({
          total: 0,
          success: 0,
          failed: 0,
          blocked: 0,
        });

        const stats = db.getRepoStats('repo-1');

        expect(stats.processed).toBe(0);
        expect(stats.success).toBe(0);
        expect(stats.failed).toBe(0);
        expect(stats.blocked).toBe(0);
      });
    });
  });

  describe('close', () => {
    it('should close the database', () => {
      db.close();

      expect(mockDb.close).toHaveBeenCalled();
    });
  });
});