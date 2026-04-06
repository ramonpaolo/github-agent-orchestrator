jest.mock('fs');

describe('Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      GITHUB_TOKEN: '',
      GITHUB_REPO: '',
      GITHUB_REPO_PATH: '',
    };
    jest.clearAllMocks();
    (require('fs').existsSync as jest.Mock).mockReturnValue(true);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('validateConfig', () => {
    it('should return false when GITHUB_TOKEN is missing', () => {
      process.env.GITHUB_REPO = 'owner/repo';
      process.env.GITHUB_REPO_PATH = '/tmp/repo';
      
      const { validateConfig } = require('../src/config');
      const result = validateConfig();
      expect(result).toBe(false);
    });

    it('should return false when GITHUB_REPO is missing', () => {
      process.env.GITHUB_TOKEN = 'test-token';
      process.env.GITHUB_REPO_PATH = '/tmp/repo';

      const { validateConfig } = require('../src/config');
      const result = validateConfig();
      expect(result).toBe(false);
    });

    it('should return false when GITHUB_REPO_PATH is missing', () => {
      process.env.GITHUB_TOKEN = 'test-token';
      process.env.GITHUB_REPO = 'owner/repo';

      const { validateConfig } = require('../src/config');
      const result = validateConfig();
      expect(result).toBe(false);
    });

    it('should return false when GITHUB_REPO_PATH does not exist', () => {
      process.env.GITHUB_TOKEN = 'test-token';
      process.env.GITHUB_REPO = 'owner/repo';
      process.env.GITHUB_REPO_PATH = '/nonexistent/path';

      (require('fs').existsSync as jest.Mock).mockReturnValue(false);

      const { validateConfig } = require('../src/config');
      const result = validateConfig();
      expect(result).toBe(false);
    });

    it('should return true when all required config is present', () => {
      process.env.GITHUB_TOKEN = 'test-token';
      process.env.GITHUB_REPO = 'owner/repo';
      process.env.GITHUB_REPO_PATH = '/tmp/repo';

      (require('fs').existsSync as jest.Mock).mockReturnValue(true);

      const { validateConfig } = require('../src/config');
      const result = validateConfig();
      expect(result).toBe(true);
    });
  });
});