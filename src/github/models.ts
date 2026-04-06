export interface Issue {
  number: number;
  title: string;
  body: string;
  author: string;
  labels: string[];
  createdAt: Date;
  updatedAt: Date;
  state: 'open' | 'closed';
  htmlUrl: string;
  assignees: string[];
}

export interface FileChange {
  path: string;
  content: string;
  operation: 'create' | 'modify' | 'delete';
}

export interface PRResult {
  success: boolean;
  prNumber?: number;
  prUrl?: string;
  branchName?: string;
  message: string;
}

export interface ProcessingResult {
  issueNumber: number;
  success: boolean;
  message: string;
  changes: FileChange[];
  prResult?: PRResult;
  error?: string;
  durationMs: number;
}

export enum IssueStatus {
  NEW = 'new',
  IN_PROGRESS = 'in_progress',
  DONE = 'done',
  FAILED = 'failed',
  BLOCKED = 'blocked',
}
