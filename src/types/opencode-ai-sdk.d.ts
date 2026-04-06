declare module '@opencode-ai/sdk' {
  export function createOpencode(options?: {
    hostname?: string;
    port?: number;
    signal?: AbortSignal;
    timeout?: number;
    config?: Record<string, any>;
  }): Promise<{
    client: any;
    server: { url: string; close: () => void };
  }>;

  export function createOpencodeClient(options?: {
    baseUrl?: string;
    fetch?: any;
    parseAs?: string;
    responseStyle?: string;
    throwOnError?: boolean;
  }): any;
}
