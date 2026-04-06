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

interface DatabaseData {
  repos: ManagedRepo[];
  logs: ProcessingLog[];
}

class DatabaseManager {
  private dbPath: string;
  private data: DatabaseData;

  constructor() {
    // Store database in user's home directory
    const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
    const dataDir = path.join(homeDir, '.github-agent-orchestrator');
    
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    this.dbPath = path.join(dataDir, 'orchestrator.json');
    this.data = this.load();
  }

  private load(): DatabaseData {
    try {
      if (fs.existsSync(this.dbPath)) {
        const content = fs.readFileSync(this.dbPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.error('Failed to load database:', error);
    }
    return { repos: [], logs: [] };
  }

  private save(): void {
    try {
      fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2));
    } catch (error) {
      console.error('Failed to save database:', error);
    }
  }

  // Repo operations
  getAllRepos(): ManagedRepo[] {
    return [...this.data.repos].sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  getRepo(id: string): ManagedRepo | null {
    return this.data.repos.find(r => r.id === id) || null;
  }

  getEnabledRepos(): ManagedRepo[] {
    return this.data.repos.filter(r => r.enabled);
  }

  addRepo(repo: Omit<ManagedRepo, 'createdAt' | 'updatedAt'>): ManagedRepo {
    const now = new Date().toISOString();
    const newRepo: ManagedRepo = {
      ...repo,
      createdAt: now,
      updatedAt: now,
    };
    this.data.repos.push(newRepo);
    this.save();
    return newRepo;
  }

  updateRepo(id: string, updates: Partial<ManagedRepo>): boolean {
    const index = this.data.repos.findIndex(r => r.id === id);
    if (index === -1) return false;

    this.data.repos[index] = {
      ...this.data.repos[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.save();
    return true;
  }

  deleteRepo(id: string): boolean {
    const index = this.data.repos.findIndex(r => r.id === id);
    if (index === -1) return false;

    this.data.repos.splice(index, 1);
    // Also delete related logs
    this.data.logs = this.data.logs.filter(l => l.repoId !== id);
    this.save();
    return true;
  }

  // Processing logs
  addLog(log: Omit<ProcessingLog, 'createdAt'>): void {
    this.data.logs.push({
      ...log,
      createdAt: new Date().toISOString(),
    });
    // Keep only last 1000 logs
    if (this.data.logs.length > 1000) {
      this.data.logs = this.data.logs.slice(-1000);
    }
    this.save();
  }

  getLogsForRepo(repoId: string, limit: number = 50): ProcessingLog[] {
    return this.data.logs
      .filter(l => l.repoId === repoId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  getRecentLogs(limit: number = 100): (ProcessingLog & { repoName?: string })[] {
    return this.data.logs
      .map(log => {
        const repo = this.data.repos.find(r => r.id === log.repoId);
        return { ...log, repoName: repo?.name };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  // Stats
  getRepoStats(repoId: string): { processed: number; success: number; failed: number; blocked: number } {
    const repoLogs = this.data.logs.filter(l => l.repoId === repoId);
    return {
      processed: repoLogs.length,
      success: repoLogs.filter(l => l.status === 'success').length,
      failed: repoLogs.filter(l => l.status === 'failed').length,
      blocked: repoLogs.filter(l => l.status === 'blocked').length,
    };
  }
}

export const db = new DatabaseManager();
