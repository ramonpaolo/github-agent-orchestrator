import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { db, ManagedRepo, Task, TaskStatus } from './database';
import { getLogEmitter } from '../opencode/client';
import { GitHubClient } from '../github/client';
import { config } from '../config';

// Get log emitter
const logEmitter = getLogEmitter();

const app = express();
const PORT = process.env.PORT || 9999;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static frontend files
const frontendPath = path.join(__dirname, '../../public');
if (fs.existsSync(frontendPath)) {
  app.use(express.static(frontendPath));
}

// API Routes

// Get all repos
app.get('/api/repos', (req: Request, res: Response) => {
  try {
    const repos = db.getAllRepos();
    const reposWithStats = repos.map(repo => ({
      ...repo,
      stats: db.getRepoStats(repo.id),
    }));
    res.json(reposWithStats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get single repo
app.get('/api/repos/:id', (req: Request, res: Response) => {
  try {
    const repo = db.getRepo(req.params.id);
    if (!repo) {
      return res.status(404).json({ error: 'Repository not found' });
    }
    const stats = db.getRepoStats(repo.id);
    res.json({ ...repo, stats });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Add new repo
app.post('/api/repos', (req: Request, res: Response) => {
  try {
    const { name, localPath, githubRepo, pollingInterval, labelFilter } = req.body;

    // Validation
    if (!name || !localPath || !githubRepo) {
      return res.status(400).json({ error: 'name, localPath, and githubRepo are required' });
    }

    // Check if localPath exists
    if (!fs.existsSync(localPath)) {
      return res.status(400).json({ error: 'Local path does not exist' });
    }

    // Check if it's a git repo
    const gitDir = path.join(localPath, '.git');
    if (!fs.existsSync(gitDir)) {
      return res.status(400).json({ error: 'Local path is not a git repository' });
    }

    // Check if githubRepo format is valid
    if (!githubRepo.includes('/')) {
      return res.status(400).json({ error: 'GitHub repo must be in format: owner/repo' });
    }

    const repo = db.addRepo({
      id: uuidv4(),
      name,
      localPath,
      githubRepo,
      pollingInterval: pollingInterval || 60,
      enabled: true,
      labelFilter: labelFilter || 'agent:ready',
    });

    res.status(201).json(repo);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update repo
app.put('/api/repos/:id', (req: Request, res: Response) => {
  try {
    const { name, localPath, githubRepo, pollingInterval, enabled, labelFilter } = req.body;

    const updated = db.updateRepo(req.params.id, {
      name,
      localPath,
      githubRepo,
      pollingInterval,
      enabled,
      labelFilter,
    });

    if (!updated) {
      return res.status(404).json({ error: 'Repository not found' });
    }

    res.json(db.getRepo(req.params.id));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete repo
app.delete('/api/repos/:id', (req: Request, res: Response) => {
  try {
    const deleted = db.deleteRepo(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Repository not found' });
    }
    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get logs for a repo
app.get('/api/repos/:id/logs', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const logs = db.getLogsForRepo(req.params.id, limit);
    res.json(logs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Task API routes
app.get('/api/tasks', (req: Request, res: Response) => {
  try {
    const repoId = req.query.repoId as string;
    const status = req.query.status as TaskStatus;

    let tasks: Task[];
    if (repoId) {
      tasks = db.getTasksByRepo(repoId);
    } else if (status) {
      tasks = db.getTasksByStatus(status);
    } else {
      tasks = db.getAllTasks();
    }
    res.json(tasks);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/tasks/:id', (req: Request, res: Response) => {
  try {
    const task = db.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(task);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tasks', (req: Request, res: Response) => {
  try {
    const { repoId, title, description, priority } = req.body;

    if (!repoId || !title) {
      return res.status(400).json({ error: 'repoId and title are required' });
    }

    const repo = db.getRepo(repoId);
    if (!repo) {
      return res.status(400).json({ error: 'Repository not found' });
    }

    const task = db.addTask({
      id: uuidv4(),
      repoId,
      title,
      description: description || '',
      status: 'backlog',
      priority: priority || 'medium',
    });

    res.status(201).json(task);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/tasks/:id', (req: Request, res: Response) => {
  try {
    const { title, description, status, priority } = req.body;

    const updated = db.updateTask(req.params.id, {
      title,
      description,
      status,
      priority,
    });

    if (!updated) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json(db.getTask(req.params.id));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/tasks/:id/move', async (req: Request, res: Response) => {
  try {
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'status is required' });
    }

    const validStatuses: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'merged', 'done'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const task = db.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const previousStatus = task.status;
    const moved = db.moveTask(req.params.id, status);
    if (!moved) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (status === 'todo' && previousStatus !== 'todo') {
      const repo = db.getRepo(task.repoId);
      if (repo && config.github.token) {
        try {
          const client = new GitHubClient(config.github.token, repo.githubRepo, repo.localPath);
          const issueBody = task.description 
            ? `${task.description}\n\n---\n*Created from task management system*`
            : `*Created from task management system*`;
          const issueNumber = await client.createIssue(
            task.title,
            issueBody,
            [config.labels.ready]
          );
          if (issueNumber) {
            console.log(`Created GitHub issue #${issueNumber} for task "${task.title}"`);
          }
        } catch (err) {
          console.error('Failed to create GitHub issue:', err);
        }
      }
    }

    res.json(db.getTask(req.params.id));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/tasks/:id', (req: Request, res: Response) => {
  try {
    const deleted = db.deleteTask(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get recent logs across all repos
app.get('/api/logs', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const logs = db.getRecentLogs(limit);
    res.json(logs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get all tasks
app.get('/api/tasks', (req: Request, res: Response) => {
  try {
    const tasks = db.getAllTasks();
    res.json(tasks);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get tasks by repo
app.get('/api/tasks/repo/:repoId', (req: Request, res: Response) => {
  try {
    const tasks = db.getTasksByRepo(req.params.repoId);
    res.json(tasks);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get tasks by status
app.get('/api/tasks/status/:status', (req: Request, res: Response) => {
  try {
    const status = req.params.status as TaskStatus;
    const validStatuses: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'merged', 'done'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const tasks = db.getTasksByStatus(status);
    res.json(tasks);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get single task
app.get('/api/tasks/:id', (req: Request, res: Response) => {
  try {
    const task = db.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(task);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create task
app.post('/api/tasks', (req: Request, res: Response) => {
  try {
    const { repoId, title, description, status, priority } = req.body;

    if (!repoId || !title) {
      return res.status(400).json({ error: 'repoId and title are required' });
    }

    const repo = db.getRepo(repoId);
    if (!repo) {
      return res.status(400).json({ error: 'Repository not found' });
    }

    const validStatuses: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'merged', 'done'];
    const taskStatus: TaskStatus = status && validStatuses.includes(status) ? status : 'backlog';
    const validPriorities = ['low', 'medium', 'high'];
    const taskPriority = priority && validPriorities.includes(priority) ? priority : 'medium';

    const task = db.addTask({
      id: uuidv4(),
      repoId,
      title,
      description: description || '',
      status: taskStatus,
      priority: taskPriority,
    });

    res.status(201).json(task);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update task
app.put('/api/tasks/:id', (req: Request, res: Response) => {
  try {
    const { title, description, status, priority } = req.body;

    const validStatuses: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'merged', 'done'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const validPriorities = ['low', 'medium', 'high'];
    if (priority && !validPriorities.includes(priority)) {
      return res.status(400).json({ error: 'Invalid priority' });
    }

    const updated = db.updateTask(req.params.id, {
      title,
      description,
      status,
      priority,
    });

    if (!updated) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json(db.getTask(req.params.id));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Move task to different column
app.put('/api/tasks/:id/move', (req: Request, res: Response) => {
  try {
    const { status } = req.body;

    const validStatuses: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'merged', 'done'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be one of: ' + validStatuses.join(', ') });
    }

    const moved = db.moveTask(req.params.id, status);

    if (!moved) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json(db.getTask(req.params.id));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete task
app.delete('/api/tasks/:id', (req: Request, res: Response) => {
  try {
    const deleted = db.deleteTask(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

// Session status - get from runner
app.get('/api/session', (req: Request, res: Response) => {
  try {
    const { runner } = require('../runner');
    const session = runner.getSessionStatus();
    res.json(session);
  } catch (error: any) {
    res.json({ active: false, error: 'Runner not initialized' });
  }
});

// Runner status
app.get('/api/runner', (req: Request, res: Response) => {
  try {
    const { runner } = require('../runner');
    res.json(runner.getStatus());
  } catch (error: any) {
    res.json({ running: false, error: 'Runner not initialized' });
  }
});

// SSE endpoint for real-time logs
app.get('/api/logs/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Send heartbeat
  res.write(`data: [heartbeat]\n\n`);

  // Listen for new logs from opencode emitter
  const handler = (log: string) => {
    res.write(`data: ${log}\n\n`);
  };
  logEmitter.on('log', handler);

  // Cleanup on disconnect
  req.on('close', () => {
    logEmitter.off('log', handler);
  });
});

// Get all logs (non-streaming)
app.get('/api/logs/all', (req: Request, res: Response) => {
  try {
    const { getLogBuffer } = require('../runner');
    res.json(getLogBuffer());
  } catch {
    res.json([]);
  }
});

// Clear logs
app.post('/api/logs/clear', (req: Request, res: Response) => {
  try {
    const { clearLogBuffer } = require('../runner');
    clearLogBuffer();
    res.json({ success: true });
  } catch {
    res.json({ success: false });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   🤖 GitHub Agent Orchestrator                                ║
║                                                               ║
║   Web Dashboard: http://localhost:${PORT}                        ║
║                                                               ║
║   API:        http://localhost:${PORT}/api                      ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});

export default app;
