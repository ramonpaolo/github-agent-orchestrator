import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export interface ManagedRepo {
  id: string;
  name: string;
  localPath: string;
  githubRepo: string;
  pollingInterval: number;
  enabled: boolean;
  labelFilter: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessingLog {
  id: string;
  repoId: string;
  issueNumber: number;
  status: 'success' | 'failed' | 'blocked';
  message: string;
  createdAt: string;
}

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'merged' | 'done';

export interface Task {
  id: string;
  repoId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: 'low' | 'medium' | 'high';
  createdAt: string;
  updatedAt: string;
}

class DatabaseManager {
  private db: Database.Database;
  private dbPath: string;

  constructor() {
    // Store database in user's home directory
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    const dataDir = path.join(homeDir, '.github-agent-orchestrator');
    
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    this.dbPath = path.join(dataDir, 'orchestrator.db');
    console.log(`💾 Database: ${this.dbPath}`);
    this.db = new Database(this.dbPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS repos (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        localPath TEXT NOT NULL,
        githubRepo TEXT NOT NULL,
        pollingInterval INTEGER DEFAULT 60,
        enabled INTEGER DEFAULT 1,
        labelFilter TEXT DEFAULT 'agent:ready',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS processing_logs (
        id TEXT PRIMARY KEY,
        repoId TEXT NOT NULL,
        issueNumber INTEGER NOT NULL,
        status TEXT NOT NULL,
        message TEXT,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (repoId) REFERENCES repos(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        repoId TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        status TEXT DEFAULT 'backlog',
        priority TEXT DEFAULT 'medium',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (repoId) REFERENCES repos(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_logs_repo ON processing_logs(repoId);
      CREATE INDEX IF NOT EXISTS idx_logs_created ON processing_logs(createdAt);
      CREATE INDEX IF NOT EXISTS idx_tasks_repo ON tasks(repoId);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    `);
  }

  // Repo operations
  getAllRepos(): ManagedRepo[] {
    const stmt = this.db.prepare('SELECT * FROM repos ORDER BY createdAt DESC');
    return stmt.all().map((row: any) => ({
      ...row,
      enabled: Boolean(row.enabled),
    }));
  }

  getRepo(id: string): ManagedRepo | null {
    const stmt = this.db.prepare('SELECT * FROM repos WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return null;
    return { ...row, enabled: Boolean(row.enabled) };
  }

  getEnabledRepos(): ManagedRepo[] {
    const stmt = this.db.prepare('SELECT * FROM repos WHERE enabled = 1');
    return stmt.all().map((row: any) => ({
      ...row,
      enabled: true,
    }));
  }

  addRepo(repo: Omit<ManagedRepo, 'createdAt' | 'updatedAt'>): ManagedRepo {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO repos (id, name, localPath, githubRepo, pollingInterval, enabled, labelFilter, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      repo.id,
      repo.name,
      repo.localPath,
      repo.githubRepo,
      repo.pollingInterval,
      repo.enabled ? 1 : 0,
      repo.labelFilter,
      now,
      now
    );
    
    return { ...repo, createdAt: now, updatedAt: now };
  }

  updateRepo(id: string, updates: Partial<ManagedRepo>): boolean {
    const repo = this.getRepo(id);
    if (!repo) return false;

    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE repos SET 
        name = ?,
        localPath = ?,
        githubRepo = ?,
        pollingInterval = ?,
        enabled = ?,
        labelFilter = ?,
        updatedAt = ?
      WHERE id = ?
    `);

    const result = stmt.run(
      updates.name ?? repo.name,
      updates.localPath ?? repo.localPath,
      updates.githubRepo ?? repo.githubRepo,
      updates.pollingInterval ?? repo.pollingInterval,
      (updates.enabled ?? repo.enabled) ? 1 : 0,
      updates.labelFilter ?? repo.labelFilter,
      now,
      id
    );

    return result.changes > 0;
  }

  deleteRepo(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM repos WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  // Processing logs
  addLog(log: Omit<ProcessingLog, 'createdAt'>): void {
    const stmt = this.db.prepare(`
      INSERT INTO processing_logs (id, repoId, issueNumber, status, message, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(log.id, log.repoId, log.issueNumber, log.status, log.message, new Date().toISOString());
  }

  getLogsForRepo(repoId: string, limit: number = 50): ProcessingLog[] {
    const stmt = this.db.prepare(`
      SELECT * FROM processing_logs 
      WHERE repoId = ? 
      ORDER BY createdAt DESC 
      LIMIT ?
    `);
    return stmt.all(repoId, limit) as ProcessingLog[];
  }

  getRecentLogs(limit: number = 100): (ProcessingLog & { repoName: string })[] {
    const stmt = this.db.prepare(`
      SELECT l.*, r.name as repoName 
      FROM processing_logs l
      JOIN repos r ON l.repoId = r.id
      ORDER BY l.createdAt DESC 
      LIMIT ?
    `);
    return stmt.all(limit) as (ProcessingLog & { repoName: string })[];
  }

  // Task operations
  getAllTasks(): Task[] {
    const stmt = this.db.prepare('SELECT * FROM tasks ORDER BY createdAt DESC');
    return stmt.all() as Task[];
  }

  getTasksByRepo(repoId: string): Task[] {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE repoId = ? ORDER BY createdAt DESC');
    return stmt.all(repoId) as Task[];
  }

  getTasksByStatus(status: TaskStatus): Task[] {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY createdAt DESC');
    return stmt.all(status) as Task[];
  }

  getTask(id: string): Task | null {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE id = ?');
    return stmt.get(id) as Task | null;
  }

  addTask(task: Omit<Task, 'createdAt' | 'updatedAt'>): Task {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, repoId, title, description, status, priority, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      task.id,
      task.repoId,
      task.title,
      task.description,
      task.status,
      task.priority,
      now,
      now
    );
    
    return { ...task, createdAt: now, updatedAt: now };
  }

  updateTask(id: string, updates: Partial<Omit<Task, 'id' | 'createdAt'>>): boolean {
    const task = this.getTask(id);
    if (!task) return false;

    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE tasks SET 
        title = ?,
        description = ?,
        status = ?,
        priority = ?,
        updatedAt = ?
      WHERE id = ?
    `);

    const result = stmt.run(
      updates.title ?? task.title,
      updates.description ?? task.description,
      updates.status ?? task.status,
      updates.priority ?? task.priority,
      now,
      id
    );

    return result.changes > 0;
  }

  deleteTask(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM tasks WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  moveTask(id: string, newStatus: TaskStatus): boolean {
    const task = this.getTask(id);
    if (!task) return false;

    const now = new Date().toISOString();
    const stmt = this.db.prepare('UPDATE tasks SET status = ?, updatedAt = ? WHERE id = ?');
    const result = stmt.run(newStatus, now, id);
    return result.changes > 0;
  }

  // Stats
  getRepoStats(repoId: string): { processed: number; success: number; failed: number; blocked: number } {
    const stmt = this.db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) as blocked
      FROM processing_logs
      WHERE repoId = ?
    `);
    const row = stmt.get(repoId) as any;
    return {
      processed: row.total || 0,
      success: row.success || 0,
      failed: row.failed || 0,
      blocked: row.blocked || 0,
    };
  }

  getTasksByRepo(repoId: string): Task[] {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE repoId = ? ORDER BY createdAt DESC');
    return stmt.all(repoId) as Task[];
  }

  getTasksByStatus(status: TaskStatus): Task[] {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY createdAt DESC');
    return stmt.all(status) as Task[];
  }

  getAllTasks(): Task[] {
    const stmt = this.db.prepare('SELECT * FROM tasks ORDER BY createdAt DESC');
    return stmt.all() as Task[];
  }

  getTask(id: string): Task | null {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE id = ?');
    return stmt.get(id) as Task | null;
  }

  addTask(task: Omit<Task, 'createdAt' | 'updatedAt'>): Task {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, repoId, title, description, status, priority, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(task.id, task.repoId, task.title, task.description, task.status, task.priority, now, now);
    return { ...task, createdAt: now, updatedAt: now };
  }

  updateTask(id: string, updates: Partial<Omit<Task, 'id' | 'createdAt' | 'updatedAt'>>): boolean {
    const task = this.getTask(id);
    if (!task) return false;

    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE tasks SET 
        title = ?,
        description = ?,
        status = ?,
        priority = ?,
        updatedAt = ?
      WHERE id = ?
    `);

    const result = stmt.run(
      updates.title ?? task.title,
      updates.description ?? task.description,
      updates.status ?? task.status,
      updates.priority ?? task.priority,
      now,
      id
    );

    return result.changes > 0;
  }

  moveTask(id: string, status: TaskStatus): boolean {
    const task = this.getTask(id);
    if (!task) return false;

    const now = new Date().toISOString();
    const stmt = this.db.prepare('UPDATE tasks SET status = ?, updatedAt = ? WHERE id = ?');
    const result = stmt.run(status, now, id);
    return result.changes > 0;
  }

  deleteTask(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM tasks WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}

export const db = new DatabaseManager();
