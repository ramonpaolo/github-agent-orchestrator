import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { db, ManagedRepo } from './database';

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

// Health check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
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
