import { RouterConfiguration } from '@/types/router-config.js';
import { createLogger, type Logger } from './logger.js';

// Local minimal type shims to avoid any
interface RouterServerConfig {
  initialConfig?: {
    providers?: unknown[];
    Router?: Record<string, string | number>;
    HOST?: string;
    PORT?: number;
  };
}

interface ToolDeclaration {
  type?: string;
}

interface RequestBody {
  model: string;
  thinking?: boolean;
  tools?: ToolDeclaration[];
  // Allow other fields without using any
  [key: string]: unknown;
}

interface HttpRequest {
  url: string;
  method: string;
  body: RequestBody;
}

interface RouterServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  addHook(
    name: 'preHandler',
    hook: (req: HttpRequest, reply: unknown) => Promise<void> | void
  ): void;
}

type RouterServerConstructor = new (config: RouterServerConfig) => RouterServer;

/**
 * Wrapper around the Claude Code Router server
 */
export class ClaudeRouterService {
  private server?: RouterServer;
  private readonly config: RouterConfiguration;
  private readonly logger: Logger;
  private readonly port = 14001; // hardcoded 14xxx port
  private Server?: RouterServerConstructor;

  constructor(config: RouterConfiguration) {
    this.config = config;
    this.logger = createLogger('ClaudeRouterService');
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.debug('Router service is disabled in configuration');
      return;
    }

    if (!this.config.providers || this.config.providers.length === 0) {
      this.logger.warn('Router enabled but no providers configured');
      return;
    }

    // Try to load the @musistudio/llms package dynamically
    try {
      const module = await import('@musistudio/llms');
      this.Server = (module as unknown as { default: RouterServerConstructor }).default;
    } catch (_error) {
      this.logger.warn('@musistudio/llms package not installed. Router service disabled.');
      this.logger.debug('Install with: npm install @musistudio/llms');
      return;
    }

    this.logger.debug(`Router service initializing with ${this.config.providers.length} provider(s)`);

    try {
      this.server = new this.Server({
        initialConfig: {
          providers: this.config.providers,
          Router: this.config.rules,
          HOST: '127.0.0.1',
          PORT: this.port
        }
      });
      
      // Add routing transformation hook BEFORE the server starts
      // This hook runs BEFORE the @musistudio/llms preHandler that splits by comma
      this.server.addHook('preHandler', async (req: HttpRequest, _reply: unknown) => {
        // Only process /v1/messages requests (Claude API format)
        if (!req.url.startsWith('/v1/messages') || req.method !== 'POST') {
          return;
        }
        
        try {
          const body = req.body;
          if (!body || !body.model) {
            return;
          }
          
          // Apply routing transformation based on rules
          let targetModel = body.model;
          
          // Check if we have specific rules for this model
          if (this.config.rules && typeof this.config.rules === 'object') {
            // Check for exact model match
            if (this.config.rules[body.model]) {
              targetModel = this.config.rules[body.model];
              this.logger.debug(`Routing ${body.model} -> ${targetModel}`);
            }
            // Check for haiku background routing
            else if (body.model?.startsWith('claude-3-5-haiku') && this.config.rules.background) {
              targetModel = this.config.rules.background;
              this.logger.debug(`Routing haiku model ${body.model} -> ${targetModel}`);
            }
            // Check for thinking mode
            else if (body.thinking && this.config.rules.think) {
              targetModel = this.config.rules.think;
              this.logger.debug(`Routing thinking mode -> ${targetModel}`);
            }
            // Check for web search
            else if (Array.isArray(body.tools) && 
                     body.tools.some((tool) => tool.type?.startsWith('web_search')) && 
                     this.config.rules.webSearch) {
              targetModel = this.config.rules.webSearch;
              this.logger.debug(`Routing web search -> ${targetModel}`);
            }
            // Use default rule if available
            else if (this.config.rules.default) {
              targetModel = this.config.rules.default;
              this.logger.debug(`Routing default ${body.model} -> ${targetModel}`);
            }
          }
          
          // Update the model in the request body
          // This will be in "provider,model" format for @musistudio/llms
          body.model = targetModel;
          
        } catch (error) {
          this.logger.error('Error in router preHandler hook:', error);
          // Don't modify the request on error, let it pass through
        }
      });
      
      await this.server.start();
      this.logger.info('Claude Code Router started', { port: this.port });
    } catch (error) {
      this.logger.error('Failed to start Claude Code Router', error);
      this.server = undefined;
      throw error;
    }
  }

  isEnabled(): boolean {
    return !!this.server;
  }

  getProxyUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  getProxyKey(): string {
    return 'router-managed';
  }

  async stop(): Promise<void> {
    if (this.server && typeof this.server.stop === 'function') {
      this.logger.debug('Stopping Claude Code Router...');
      await this.server.stop();
      this.server = undefined;
      this.logger.debug('Claude Code Router stopped successfully');
    }
  }
}
