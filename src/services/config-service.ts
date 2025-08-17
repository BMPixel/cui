import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { CUIConfig, DEFAULT_CONFIG, InterfaceConfig, ServerConfig } from '@/types/config.js';
import { generateMachineId } from '@/utils/machine-id.js';
import { createLogger, type Logger } from './logger.js';
import { EventEmitter } from 'events';
import type { RouterConfiguration, RouterProvider } from '@/types/router-config.js';

/**
 * ConfigService manages CUI configuration
 * Loads from ~/.cui/config.json
 * Creates default config on first run
 */
export class ConfigService {
  private static instance: ConfigService;
  private config: CUIConfig | null = null;
  private logger: Logger;
  private configPath: string;
  private configDir: string;
  private emitter: EventEmitter = new EventEmitter();
  private watcher?: import('fs').FSWatcher;
  private debounceTimer?: NodeJS.Timeout;
  private lastLoadedRaw?: string;
  private pollInterval?: NodeJS.Timeout;

  private constructor() {
    this.logger = createLogger('ConfigService');
    this.configDir = path.join(os.homedir(), '.cui');
    this.configPath = path.join(this.configDir, 'config.json');
  }

  /**
   * Get singleton instance
   */
  static getInstance(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService();
    }
    return ConfigService.instance;
  }

  /**
   * Initialize configuration
   * Creates config file if it doesn't exist
   * Throws error if initialization fails
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing configuration', { configPath: this.configPath });

    try {
      // Check if config exists
      if (!fs.existsSync(this.configPath)) {
        await this.createDefaultConfig();
      }

      // Load and validate config
      await this.loadConfig();

      // Start watching for external changes
      this.startWatching();
    } catch (error) {
      this.logger.error('Failed to initialize configuration', error);
      throw new Error(`Configuration initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get current configuration
   * Throws if not initialized
   */
  getConfig(): CUIConfig {
    if (!this.config) {
      throw new Error('Configuration not initialized. Call initialize() first.');
    }
    return this.config;
  }

  /**
   * Create default configuration
   */
  private async createDefaultConfig(): Promise<void> {
    this.logger.info('Creating default configuration');

    try {
      // Ensure config directory exists
      if (!fs.existsSync(this.configDir)) {
        fs.mkdirSync(this.configDir, { recursive: true });
        this.logger.debug('Created config directory', { dir: this.configDir });
      }

      // Generate machine ID
      const machineId = await generateMachineId();
      this.logger.debug('Generated machine ID', { machineId });

      // Generate crypto-secure auth token
      const authToken = crypto.randomBytes(16).toString('hex'); // 32 character hex string
      this.logger.debug('Generated auth token', { tokenLength: authToken.length });

      // Create default config
      const config: CUIConfig = {
        machine_id: machineId,
        authToken,
        ...DEFAULT_CONFIG
      };

      // Write config file
      fs.writeFileSync(
        this.configPath,
        JSON.stringify(config, null, 2),
        'utf-8'
      );

      this.logger.info('Default configuration created', {
        path: this.configPath,
        machineId: config.machine_id
      });
    } catch (error) {
      throw new Error(`Failed to create default config: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Load configuration from file
   */
  private async loadConfig(): Promise<void> {
    try {
      const configData = fs.readFileSync(this.configPath, 'utf-8');
      let fileConfig: Partial<CUIConfig> & { machine_id?: string; authToken?: string };
      try {
        fileConfig = JSON.parse(configData) as Partial<CUIConfig> & { machine_id?: string; authToken?: string };
      } catch (_parseError) {
        // Corrupted JSON should fail startup
        throw new Error('Invalid JSON in configuration file');
      }

      // Migrate legacy ntfyUrl to new structure
      let migrated = false;
      if (fileConfig.interface?.notifications && 'ntfyUrl' in fileConfig.interface.notifications) {
        const notifications = fileConfig.interface.notifications as any;
        if (!notifications.ntfy) {
          notifications.ntfy = {
            enabled: false, // Default to false as requested
            url: notifications.ntfyUrl
          };
        }
        delete notifications.ntfyUrl;
        migrated = true;
        this.logger.info('Migrated legacy ntfyUrl to new ntfy configuration structure');
      }

      // Validate provided fields (strict for provided keys, allow missing)
      this.validateProvidedFields(fileConfig);

      // Merge with defaults for missing sections while preserving all existing fields (e.g., router)
      let updated = migrated;
      const merged: CUIConfig = {
        // Start with defaults
        ...DEFAULT_CONFIG,
        // Bring over everything from file (including optional fields like router, gemini)
        ...fileConfig,
        // Ensure required identifiers are set from file
        machine_id: fileConfig.machine_id || (await generateMachineId()),
        authToken: fileConfig.authToken || crypto.randomBytes(16).toString('hex'),
        // Deep-merge known nested sections to ensure defaults are filled without dropping user values
        server: { ...DEFAULT_CONFIG.server, ...(fileConfig.server || {}) },
        interface: { ...DEFAULT_CONFIG.interface, ...(fileConfig.interface || {}) }
      };

      // Determine if we added any defaults and need to persist back to disk
      if (!fileConfig.server || JSON.stringify(merged.server) !== JSON.stringify(fileConfig.server)) updated = true;
      if (!fileConfig.interface || JSON.stringify(merged.interface) !== JSON.stringify(fileConfig.interface)) updated = true;
      if (!fileConfig.machine_id) updated = true;
      if (!fileConfig.authToken) updated = true;

      // Final validation on fully merged config
      this.validateCompleteConfig(merged);

      this.config = merged;
      this.lastLoadedRaw = JSON.stringify(this.config, null, 2);
      if (updated) {
        fs.writeFileSync(this.configPath, this.lastLoadedRaw, 'utf-8');
        this.logger.info('Configuration updated with defaults');
      }
      this.logger.debug('Configuration loaded successfully');
    } catch (error) {
      throw new Error(`Failed to load config: ${error instanceof Error ? error.message : String(error)}`);
    }
  }


  /**
   * Update configuration
   */
  async updateConfig(updates: Partial<CUIConfig>): Promise<void> {
    if (!this.config) {
      throw new Error('Configuration not initialized');
    }

    this.logger.info('Updating configuration', { updates });

    // Create a new config via deep-merge semantics so unrelated options are preserved
    const current = this.config;

    const mergedServer = updates.server ? { ...current.server, ...updates.server } : current.server;

    const mergedInterface = updates.interface
      ? {
          ...current.interface,
          ...updates.interface,
          // Deep-merge nested notifications object if provided
          notifications:
            updates.interface.notifications !== undefined
              ? { ...(current.interface.notifications || {}), ...updates.interface.notifications }
              : current.interface.notifications
        }
      : current.interface;

    const mergedRouter = updates.router
      ? { ...(current.router || {}), ...updates.router }
      : current.router;

    const mergedGemini = updates.gemini
      ? { ...(current.gemini || {}), ...updates.gemini }
      : current.gemini;

    // Preserve machine_id and authToken regardless of updates
    const newConfig: CUIConfig = {
      ...current,
      server: mergedServer,
      interface: mergedInterface,
      gemini: mergedGemini,
      router: mergedRouter
    };

    // Update in-memory config
    const prev = this.config;
    this.config = newConfig;
    
    // Write to file
    try {
      this.lastLoadedRaw = JSON.stringify(this.config, null, 2);
      fs.writeFileSync(this.configPath, this.lastLoadedRaw, 'utf-8');
      this.logger.info('Configuration updated successfully');
      // Emit change event for internal updates
      this.emitter.emit('config-changed', this.config, prev, 'internal');
    } catch (error) {
      this.logger.error('Failed to update configuration', error);
      throw new Error(`Failed to update config: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Subscribe to configuration changes
   */
  onChange(listener: (newConfig: CUIConfig, previous: CUIConfig | null, source: 'internal' | 'external') => void): void {
    this.emitter.on('config-changed', listener);
  }

  /**
   * Validate provided fields in a partial config. Throws on incompatible values.
   */
  private validateProvidedFields(partial: Partial<CUIConfig>): void {
    // server
    if (partial.server) {
      this.assertServerConfig(partial.server);
    }
    // interface
    if (partial.interface) {
      this.assertInterfaceConfig(partial.interface);
    }
    // router
    if (partial.router) {
      this.assertRouterConfig(partial.router);
    }
    // gemini (optional)
    if (partial.gemini) {
      if (partial.gemini.apiKey !== undefined && typeof partial.gemini.apiKey !== 'string') {
        throw new Error('Invalid config: gemini.apiKey must be a string');
      }
      if (partial.gemini.model !== undefined && typeof partial.gemini.model !== 'string') {
        throw new Error('Invalid config: gemini.model must be a string');
      }
    }
    // machine_id/authToken if present must be strings
    if (partial.machine_id !== undefined && typeof partial.machine_id !== 'string') {
      throw new Error('Invalid config: machine_id must be a string');
    }
    if (partial.authToken !== undefined && typeof partial.authToken !== 'string') {
      throw new Error('Invalid config: authToken must be a string');
    }
  }

  /**
   * Validate a complete merged config before using it. Throws on error.
   */
  private validateCompleteConfig(config: CUIConfig): void {
    // Required top-level values
    if (!config.machine_id || typeof config.machine_id !== 'string') {
      throw new Error('Invalid config: missing machine_id');
    }
    this.assertServerConfig(config.server);
    if (!config.authToken || typeof config.authToken !== 'string') {
      throw new Error('Invalid config: missing authToken');
    }
    if (config.interface) {
      this.assertInterfaceConfig(config.interface);
    }
    if (config.router) {
      this.assertRouterConfig(config.router);
    }
  }

  private assertServerConfig(server: Partial<ServerConfig>): void {
    if (server.host !== undefined && typeof server.host !== 'string') {
      throw new Error('Invalid config: server.host must be a string');
    }
    if (server.port !== undefined && typeof server.port !== 'number') {
      throw new Error('Invalid config: server.port must be a number');
    }
  }

  private assertInterfaceConfig(iface: Partial<InterfaceConfig>): void {
    if (iface.colorScheme !== undefined && !['light', 'dark', 'system'].includes(iface.colorScheme as string)) {
      throw new Error("Invalid config: interface.colorScheme must be 'light' | 'dark' | 'system'");
    }
    if (iface.language !== undefined && typeof iface.language !== 'string') {
      throw new Error('Invalid config: interface.language must be a string');
    }
    if (iface.notifications !== undefined) {
      const n = iface.notifications as InterfaceConfig['notifications'];
      if (n && typeof n.enabled !== 'boolean') {
        throw new Error('Invalid config: interface.notifications.enabled must be a boolean');
      }
      // Validate ntfy settings
      if (n && n.ntfy !== undefined) {
        if (typeof n.ntfy !== 'object' || n.ntfy === null) {
          throw new Error('Invalid config: interface.notifications.ntfy must be an object');
        }
        if (n.ntfy.enabled !== undefined && typeof n.ntfy.enabled !== 'boolean') {
          throw new Error('Invalid config: interface.notifications.ntfy.enabled must be a boolean');
        }
        if (n.ntfy.url !== undefined && typeof n.ntfy.url !== 'string') {
          throw new Error('Invalid config: interface.notifications.ntfy.url must be a string');
        }
      }
    }
  }

  private assertRouterConfig(router: Partial<RouterConfiguration>): void {
    if (router.enabled !== undefined && typeof router.enabled !== 'boolean') {
      throw new Error('Invalid config: router.enabled must be a boolean');
    }
    if (router.providers !== undefined) {
      if (!Array.isArray(router.providers)) {
        throw new Error('Invalid config: router.providers must be an array');
      }
      for (const p of router.providers as RouterProvider[]) {
        if (p.name !== undefined && typeof p.name !== 'string') throw new Error('Invalid config: router.providers[].name must be a string');
        if (p.api_base_url !== undefined && typeof p.api_base_url !== 'string') throw new Error('Invalid config: router.providers[].api_base_url must be a string');
        if (p.api_key !== undefined && typeof p.api_key !== 'string') throw new Error('Invalid config: router.providers[].api_key must be a string');
        if (p.models !== undefined && !Array.isArray(p.models)) throw new Error('Invalid config: router.providers[].models must be an array of strings');
        if (Array.isArray(p.models)) {
          for (const m of p.models) {
            if (typeof m !== 'string') throw new Error('Invalid config: router.providers[].models must contain strings');
          }
        }
      }
    }
    if (router.rules !== undefined) {
      if (typeof router.rules !== 'object' || router.rules === null || Array.isArray(router.rules)) {
        throw new Error('Invalid config: router.rules must be an object of string values');
      }
      for (const [k, v] of Object.entries(router.rules)) {
        if (typeof v !== 'string') throw new Error(`Invalid config: router.rules['${k}'] must be a string`);
      }
    }
  }

  private startWatching(): void {
    // Avoid multiple watchers in tests
    if (this.watcher) return;
    try {
      // Increase listeners to avoid noisy warnings in tests with many server instances
      this.emitter.setMaxListeners(0);

      if (process.env.NODE_ENV === 'test') {
        // Use active polling in tests to avoid fs watcher flakiness with fake timers
        this.pollInterval = setInterval(() => {
          try {
            const raw = fs.readFileSync(this.configPath, 'utf-8');
            if (!this.lastLoadedRaw || raw !== this.lastLoadedRaw) {
              // Debounce within polling
              if (this.debounceTimer) clearTimeout(this.debounceTimer);
              this.debounceTimer = setTimeout(() => this.handleExternalChange(), 10);
            }
          } catch {
            // ignore
          }
        }, 50);
        this.logger.debug('Started interval polling for configuration changes (test mode)');
      } else {
        this.watcher = fs.watch(this.configPath, { persistent: false }, (eventType) => {
          if (eventType !== 'change' && eventType !== 'rename') return;
          if (this.debounceTimer) clearTimeout(this.debounceTimer);
          this.debounceTimer = setTimeout(() => this.handleExternalChange(), 250);
        });
        this.logger.debug('Started watching configuration file for changes');
      }
    } catch (error) {
      this.logger.warn('Failed to start file watcher for configuration', error as Error);
    }
  }

  private handleExternalChange(): void {
    try {
      const newRaw = fs.readFileSync(this.configPath, 'utf-8');
      if (this.lastLoadedRaw && newRaw === this.lastLoadedRaw) {
        return; // No effective change
      }
      let parsed: Partial<CUIConfig> & { machine_id?: string; authToken?: string };
      try {
        parsed = JSON.parse(newRaw);
      } catch (_e) {
        this.logger.error('Ignoring external config change due to invalid JSON');
        return;
      }
      // Validate provided fields strictly
      this.validateProvidedFields(parsed);
      // Merge and validate complete
      const current = this.config || ({ ...DEFAULT_CONFIG, machine_id: '', authToken: '' } as unknown as CUIConfig);
      const merged: CUIConfig = {
        ...DEFAULT_CONFIG,
        ...current,
        ...parsed,
        server: { ...DEFAULT_CONFIG.server, ...(current.server || {}), ...(parsed.server || {}) },
        interface: { ...DEFAULT_CONFIG.interface, ...(current.interface || {}), ...(parsed.interface || {}) },
        router: parsed.router !== undefined ? (parsed.router as CUIConfig['router']) : current.router,
        gemini: parsed.gemini !== undefined ? (parsed.gemini as CUIConfig['gemini']) : current.gemini,
        machine_id: parsed.machine_id || current.machine_id,
        authToken: parsed.authToken || current.authToken
      };
      this.validateCompleteConfig(merged);
      const prev = this.config;
      this.config = merged;
      this.lastLoadedRaw = JSON.stringify(merged, null, 2);
      this.logger.info('Configuration reloaded from external change');
      this.emitter.emit('config-changed', this.config, prev || null, 'external');
    } catch (error) {
      this.logger.error('Failed to handle external configuration change', error as Error);
    }
  }

  /**
   * Reset singleton instance (for testing)
   */
  static resetInstance(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ConfigService.instance = null as any;
  }
}