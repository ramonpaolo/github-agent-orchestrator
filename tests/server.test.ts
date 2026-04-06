import express, { Express } from 'express';
import request from 'supertest';

jest.mock('../src/web/database', () => ({
  db: {
    getAllRepos: jest.fn(),
    getRepo: jest.fn(),
    addRepo: jest.fn(),
    updateRepo: jest.fn(),
    deleteRepo: jest.fn(),
    getLogsForRepo: jest.fn(),
    getRecentLogs: jest.fn(),
    getAllTasks: jest.fn(),
    getTasksByRepo: jest.fn(),
    getTasksByStatus: jest.fn(),
    getTask: jest.fn(),
    addTask: jest.fn(),
    updateTask: jest.fn(),
    deleteTask: jest.fn(),
    moveTask: jest.fn(),
    getRepoStats: jest.fn(),
  },
  ManagedRepo: {},
  Task: {},
  TaskStatus: {},
}));

jest.mock('../src/opencode/client', () => ({
  getLogEmitter: () => ({ emit: jest.fn(), on: jest.fn(), off: jest.fn() }),
}));

jest.mock('../src/runner', () => ({
  runner: {
    getSessionStatus: jest.fn().mockReturnValue({ active: false }),
    getStatus: jest.fn().mockReturnValue({ running: false, workers: 0, repos: [] }),
  },
  getLogBuffer: jest.fn().mockReturnValue([]),
  clearLogBuffer: jest.fn(),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(true),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  readdirSync: jest.fn().mockReturnValue([]),
  statSync: jest.fn().mockReturnValue({ isDirectory: () => false }),
}));

jest.mock('path', () => ({
  join: jest.fn().mockReturnValue('/mock/path'),
}));

const mockDb = require('../src/web/database').db;

describe('Web Server API', () => {
  let app: Express;

  beforeAll(() => {
    jest.mock('../src/config', () => ({
      config: {
        labels: {
          ready: 'agent:ready',
          implementing: 'agent:implementing',
          done: 'agent:done',
          failed: 'agent:failed',
          blocked: 'agent:blocked',
        },
        github: {
          token: 'test-token',
        },
      },
    }));

    app = require('../src/web/server').default;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Health Check', () => {
    it('GET /api/health should return ok status', async () => {
      const response = await request(app).get('/api/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.timestamp).toBeDefined();
    });
  });

  describe('Repos API', () => {
    const mockRepo = {
      id: 'repo-1',
      name: 'Test Repo',
      localPath: '/tmp/repo',
      githubRepo: 'owner/repo',
      pollingInterval: 60,
      enabled: true,
      labelFilter: 'agent:ready',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    describe('GET /api/repos', () => {
      it('should return all repos', async () => {
        mockDb.getAllRepos.mockReturnValue([mockRepo]);
        mockDb.getRepoStats.mockReturnValue({ processed: 0, success: 0, failed: 0, blocked: 0 });

        const response = await request(app).get('/api/repos');

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(1);
        expect(response.body[0].name).toBe('Test Repo');
      });

      it('should handle errors', async () => {
        mockDb.getAllRepos.mockImplementation(() => {
          throw new Error('Database error');
        });

        const response = await request(app).get('/api/repos');

        expect(response.status).toBe(500);
      });
    });

    describe('GET /api/repos/:id', () => {
      it('should return a single repo', async () => {
        mockDb.getRepo.mockReturnValue(mockRepo);
        mockDb.getRepoStats.mockReturnValue({ processed: 5, success: 3, failed: 1, blocked: 1 });

        const response = await request(app).get('/api/repos/repo-1');

        expect(response.status).toBe(200);
        expect(response.body.id).toBe('repo-1');
      });

      it('should return 404 when repo not found', async () => {
        mockDb.getRepo.mockReturnValue(null);

        const response = await request(app).get('/api/repos/non-existent');

        expect(response.status).toBe(404);
      });
    });

    describe('POST /api/repos', () => {
      it('should create a new repo', async () => {
        mockDb.addRepo.mockReturnValue(mockRepo);

        const response = await request(app)
          .post('/api/repos')
          .send({
            name: 'Test Repo',
            localPath: '/tmp/repo',
            githubRepo: 'owner/repo',
          });

        expect(response.status).toBe(201);
        expect(mockDb.addRepo).toHaveBeenCalled();
      });

      it('should return 400 when required fields missing', async () => {
        const response = await request(app)
          .post('/api/repos')
          .send({
            name: 'Test Repo',
          });

        expect(response.status).toBe(400);
      });
    });

    describe('PUT /api/repos/:id', () => {
      it('should update a repo', async () => {
        mockDb.updateRepo.mockReturnValue(true);
        mockDb.getRepo.mockReturnValue({ ...mockRepo, name: 'Updated Repo' });

        const response = await request(app)
          .put('/api/repos/repo-1')
          .send({ name: 'Updated Repo' });

        expect(response.status).toBe(200);
      });

      it('should return 404 when repo not found', async () => {
        mockDb.updateRepo.mockReturnValue(false);

        const response = await request(app)
          .put('/api/repos/non-existent')
          .send({ name: 'Updated Repo' });

        expect(response.status).toBe(404);
      });
    });

    describe('DELETE /api/repos/:id', () => {
      it('should delete a repo', async () => {
        mockDb.deleteRepo.mockReturnValue(true);

        const response = await request(app).delete('/api/repos/repo-1');

        expect(response.status).toBe(204);
      });

      it('should return 404 when repo not found', async () => {
        mockDb.deleteRepo.mockReturnValue(false);

        const response = await request(app).delete('/api/repos/non-existent');

        expect(response.status).toBe(404);
      });
    });
  });

  describe('Tasks API', () => {
    const mockTask = {
      id: 'task-1',
      repoId: 'repo-1',
      title: 'Test Task',
      description: 'Description',
      internalDescription: '',
      status: 'backlog',
      priority: 'medium',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    describe('GET /api/tasks', () => {
      it('should return all tasks', async () => {
        mockDb.getAllTasks.mockReturnValue([mockTask]);

        const response = await request(app).get('/api/tasks');

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(1);
      });

      it('should filter by repoId', async () => {
        mockDb.getTasksByRepo.mockReturnValue([mockTask]);

        const response = await request(app).get('/api/tasks?repoId=repo-1');

        expect(response.status).toBe(200);
        expect(mockDb.getTasksByRepo).toHaveBeenCalledWith('repo-1');
      });

      it('should filter by status', async () => {
        mockDb.getTasksByStatus.mockReturnValue([mockTask]);

        const response = await request(app).get('/api/tasks?status=backlog');

        expect(response.status).toBe(200);
        expect(mockDb.getTasksByStatus).toHaveBeenCalledWith('backlog');
      });
    });

    describe('GET /api/tasks/:id', () => {
      it('should return a single task', async () => {
        mockDb.getTask.mockReturnValue(mockTask);

        const response = await request(app).get('/api/tasks/task-1');

        expect(response.status).toBe(200);
        expect(response.body.id).toBe('task-1');
      });

      it('should return 404 when task not found', async () => {
        mockDb.getTask.mockReturnValue(null);

        const response = await request(app).get('/api/tasks/non-existent');

        expect(response.status).toBe(404);
      });
    });

    describe('POST /api/tasks', () => {
      it('should create a new task', async () => {
        mockDb.addTask.mockReturnValue(mockTask);

        const response = await request(app)
          .post('/api/tasks')
          .send({
            repoId: 'repo-1',
            title: 'Test Task',
          });

        expect(response.status).toBe(201);
      });

      it('should return 400 when required fields missing', async () => {
        const response = await request(app)
          .post('/api/tasks')
          .send({
            title: 'Test Task',
          });

        expect(response.status).toBe(400);
      });

      it('should return 400 when repo not found', async () => {
        mockDb.getRepo.mockReturnValue(null);

        const response = await request(app)
          .post('/api/tasks')
          .send({
            repoId: 'non-existent',
            title: 'Test Task',
          });

        expect(response.status).toBe(400);
      });
    });

    describe('PUT /api/tasks/:id', () => {
      it('should update a task', async () => {
        mockDb.updateTask.mockReturnValue(true);
        mockDb.getTask.mockReturnValue({ ...mockTask, title: 'Updated Task' });

        const response = await request(app)
          .put('/api/tasks/task-1')
          .send({ title: 'Updated Task' });

        expect(response.status).toBe(200);
      });

      it('should return 404 when task not found', async () => {
        mockDb.updateTask.mockReturnValue(false);

        const response = await request(app)
          .put('/api/tasks/non-existent')
          .send({ title: 'Updated Task' });

        expect(response.status).toBe(404);
      });
    });

    describe('PATCH /api/tasks/:id/move', () => {
      it('should move a task to new status', async () => {
        mockDb.moveTask.mockReturnValue(true);
        mockDb.getTask.mockReturnValue({ ...mockTask, status: 'todo' });

        const response = await request(app)
          .patch('/api/tasks/task-1/move')
          .send({ status: 'todo' });

        expect(response.status).toBe(200);
      });

      it('should return 400 when status is invalid', async () => {
        const response = await request(app)
          .patch('/api/tasks/task-1/move')
          .send({ status: 'invalid' });

        expect(response.status).toBe(400);
      });

      it('should return 404 when task not found', async () => {
        mockDb.getTask.mockReturnValue(null);

        const response = await request(app)
          .patch('/api/tasks/non-existent/move')
          .send({ status: 'todo' });

        expect(response.status).toBe(404);
      });
    });

    describe('DELETE /api/tasks/:id', () => {
      it('should delete a task', async () => {
        mockDb.deleteTask.mockReturnValue(true);

        const response = await request(app).delete('/api/tasks/task-1');

        expect(response.status).toBe(204);
      });

      it('should return 404 when task not found', async () => {
        mockDb.deleteTask.mockReturnValue(false);

        const response = await request(app).delete('/api/tasks/non-existent');

        expect(response.status).toBe(404);
      });
    });
  });

  describe('Logs API', () => {
    const mockLog = {
      id: 'log-1',
      repoId: 'repo-1',
      issueNumber: 1,
      status: 'success',
      message: 'Completed',
      createdAt: '2024-01-01T00:00:00Z',
    };

    describe('GET /api/logs', () => {
      it('should return recent logs', async () => {
        mockDb.getRecentLogs.mockReturnValue([{ ...mockLog, repoName: 'Test Repo' }]);

        const response = await request(app).get('/api/logs');

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(1);
      });
    });

    describe('GET /api/repos/:id/logs', () => {
      it('should return logs for a repo', async () => {
        mockDb.getLogsForRepo.mockReturnValue([mockLog]);

        const response = await request(app).get('/api/repos/repo-1/logs');

        expect(response.status).toBe(200);
        expect(response.body).toHaveLength(1);
      });
    });
  });

  describe('Session API', () => {
    describe('GET /api/session', () => {
      it('should return session status', async () => {
        const response = await request(app).get('/api/session');

        expect(response.status).toBe(200);
        expect(response.body.active).toBeDefined();
      });
    });

    describe('GET /api/runner', () => {
      it('should return runner status', async () => {
        const response = await request(app).get('/api/runner');

        expect(response.status).toBe(200);
        expect(response.body.running).toBeDefined();
      });
    });
  });
});