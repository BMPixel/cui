import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { ConfigService } from '@/services/config-service.js';
import { generateMachineId } from '@/utils/machine-id';
import { CUIConfig } from '@/types/config';

describe('Configuration System Basic Integration', () => {
  let testConfigDir: string;
  let originalHome: string;

  beforeAll(() => {
    // Create temporary config directory for tests
    testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cui-config-basic-test-'));
    
    // Mock the home directory to use our test directory
    originalHome = os.homedir();
    vi.spyOn(os, 'homedir').mockReturnValue(testConfigDir);
  });

  afterAll(() => {
    // Restore original home directory
    (os.homedir as any<typeof os.homedir>).mockRestore();
    
    // Clean up test config directory
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    // Clear any existing config directory
    const cuiDir = path.join(testConfigDir, '.cui');
    if (fs.existsSync(cuiDir)) {
      fs.rmSync(cuiDir, { recursive: true, force: true });
    }
    
    // Reset ConfigService singleton
    const configService = ConfigService.getInstance();
    (configService as any).isInitialized = false;
    (configService as any).config = null;
  });

  describe('Configuration File Creation', () => {
    it('should create config directory and file on first initialization', async () => {
      const configService = ConfigService.getInstance();
      
      // Config directory should not exist initially
      expect(fs.existsSync(path.join(testConfigDir, '.cui'))).toBe(false);
      
      await configService.initialize();
      
      // Config directory and file should now exist
      const cuiDir = path.join(testConfigDir, '.cui');
      const configPath = path.join(cuiDir, 'config.json');
      
      expect(fs.existsSync(cuiDir)).toBe(true);
      expect(fs.existsSync(configPath)).toBe(true);
      
      // Verify config file structure
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configContent);
      
      expect(config).toHaveProperty('machine_id');
      expect(config).toHaveProperty('server');
      expect(config.server).toHaveProperty('host', 'localhost');
      expect(config.server).toHaveProperty('port', 3001);
    });

    it('should load existing config file if it exists', async () => {
      // Create a pre-existing config file
      const cuiDir = path.join(testConfigDir, '.cui');
      fs.mkdirSync(cuiDir, { recursive: true });
      
      const existingConfig: CUIConfig = {
        machine_id: 'test-machine-12345678',
        authToken: crypto.randomBytes(16).toString('hex'),
        server: {
          host: '127.0.0.1',
          port: 4000
        }
      };
      
      fs.writeFileSync(
        path.join(cuiDir, 'config.json'), 
        JSON.stringify(existingConfig, null, 2)
      );
      
      const configService = ConfigService.getInstance();
      await configService.initialize();
      
      const loadedConfig = configService.getConfig();
      
      expect(loadedConfig.machine_id).toBe('test-machine-12345678');
      expect(loadedConfig.server.host).toBe('127.0.0.1');
      expect(loadedConfig.server.port).toBe(4000);
    });
  });

  describe('Machine ID Generation', () => {
    it('should generate consistent machine ID format', async () => {
      const machineId = await generateMachineId();
      
      // Should match format: {hostname}-{16char_hash}
      const pattern = /^[a-z0-9\-]+\-[a-f0-9]{16}$/;
      expect(machineId).toMatch(pattern);
      
      // Should start with lowercase hostname (with dots removed but hyphens preserved)
      const hostname = os.hostname().toLowerCase();
      expect(machineId).toMatch(new RegExp(`^${hostname.replace(/[^a-z0-9-]/g, '')}`));
    });

    it('should generate the same machine ID on multiple calls', async () => {
      const machineId1 = await generateMachineId();
      const machineId2 = await generateMachineId();
      
      expect(machineId1).toBe(machineId2);
    });

    it('should persist machine ID across config service restarts', async () => {
      const configService1 = ConfigService.getInstance();
      await configService1.initialize();
      const config1 = configService1.getConfig();
      
      // Reset and reinitialize
      (configService1 as any).isInitialized = false;
      (configService1 as any).config = null;
      
      const configService2 = ConfigService.getInstance();
      await configService2.initialize();
      const config2 = configService2.getConfig();
      
      expect(config1.machine_id).toBe(config2.machine_id);
    });
  });

  describe('ConfigService Singleton Behavior', () => {
    it('should return the same instance across multiple calls', () => {
      const instance1 = ConfigService.getInstance();
      const instance2 = ConfigService.getInstance();
      
      expect(instance1).toBe(instance2);
    });

    it('should throw error when accessing config before initialization', () => {
      const configService = ConfigService.getInstance();
      
      expect(() => configService.getConfig()).toThrow('Configuration not initialized');
    });

    it('should prevent multiple initializations', async () => {
      const configService = ConfigService.getInstance();
      
      await configService.initialize();
      
      // Second initialization should not throw
      await expect(configService.initialize()).resolves.not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should fail startup on malformed config file', async () => {
      // Create malformed config file
      const cuiDir = path.join(testConfigDir, '.cui');
      fs.mkdirSync(cuiDir, { recursive: true });
      
      fs.writeFileSync(
        path.join(cuiDir, 'config.json'), 
        '{ invalid json content'
      );
      
      const configService = ConfigService.getInstance();
      
      await expect(configService.initialize()).rejects.toThrow();
    });

    it('should allow missing fields and fill defaults', async () => {
      // Create config missing optional/mergeable fields
      const cuiDir = path.join(testConfigDir, '.cui');
      fs.mkdirSync(cuiDir, { recursive: true });

      fs.writeFileSync(
        path.join(cuiDir, 'config.json'),
        JSON.stringify({ machine_id: 'test-machine-11112222', authToken: 'tok', server: { port: 5555, host: '0.0.0.0' } })
      );

      const configService = ConfigService.getInstance();
      await expect(configService.initialize()).resolves.not.toThrow();
      const loaded = configService.getConfig();
      expect(loaded.interface).toBeDefined();
      expect(loaded.server.port).toBe(5555);
      expect(loaded.machine_id).toBe('test-machine-11112222');
    });
  });

  describe('Default Configuration Values', () => {
    it('should create config with correct default values', async () => {
      const configService = ConfigService.getInstance();
      await configService.initialize();
      
      const config = configService.getConfig();
      
      expect(config.server.host).toBe('localhost');
      expect(config.server.port).toBe(3001);
      expect(config.machine_id).toBeDefined();
      expect(config.machine_id).toMatch(/^[a-z0-9\-]+\-[a-f0-9]{16}$/);
    });

    it('should generate machine ID with correct hostname prefix', async () => {
      const configService = ConfigService.getInstance();
      await configService.initialize();
      
      const config = configService.getConfig();
      const hostname = os.hostname().toLowerCase();
      
      // Machine ID should start with hostname (with dots removed but hyphens preserved)
      const cleanHostname = hostname.replace(/[^a-z0-9-]/gi, '').toLowerCase();
      expect(config.machine_id).toMatch(new RegExp(`^${cleanHostname}`));
    });
  });

  describe('Preservation and Deep-Merge Behavior', () => {
    it('should preserve optional fields like router on initialization and not remove them when rewriting', async () => {
      const cuiDir = path.join(testConfigDir, '.cui');
      fs.mkdirSync(cuiDir, { recursive: true });

      const existingConfig = {
        machine_id: 'test-machine-router-12345678',
        authToken: crypto.randomBytes(16).toString('hex'),
        server: { host: '127.0.0.1', port: 4100 },
        router: {
          enabled: true,
          providers: [
            { name: 'providerA', api_base_url: 'https://api.example.com', api_key: 'key', models: ['modelA'] }
          ],
          rules: { default: 'modelA' }
        },
        interface: { colorScheme: 'dark', language: 'ja' }
      };

      fs.writeFileSync(path.join(cuiDir, 'config.json'), JSON.stringify(existingConfig, null, 2));

      const configService = ConfigService.getInstance();
      await configService.initialize();

      const loaded = configService.getConfig();
      expect(loaded.machine_id).toBe('test-machine-router-12345678');
      expect(loaded.server.port).toBe(4100);
      expect(loaded.interface.language).toBe('ja');
      // Router should be preserved
      expect(loaded.router).toBeDefined();
      expect(loaded.router?.enabled).toBe(true);
      expect(loaded.router?.providers?.[0]?.name).toBe('providerA');
      expect(loaded.router?.rules?.default).toBe('modelA');

      // Ensure file on disk still contains router field after potential rewrite
      const disk = JSON.parse(fs.readFileSync(path.join(cuiDir, 'config.json'), 'utf-8'));
      expect(disk.router).toBeDefined();
      expect(disk.router.enabled).toBe(true);
      expect(disk.interface.language).toBe('ja');
    });

    it('should deep-merge partial interface updates and not reset unrelated options', async () => {
      const cuiDir = path.join(testConfigDir, '.cui');
      fs.mkdirSync(cuiDir, { recursive: true });

      const initialConfig: CUIConfig = {
        machine_id: 'test-machine-merge-12345678',
        authToken: crypto.randomBytes(16).toString('hex'),
        server: { host: 'localhost', port: 3001 },
        interface: { colorScheme: 'system', language: 'zh' }
      } as CUIConfig;

      fs.writeFileSync(path.join(cuiDir, 'config.json'), JSON.stringify(initialConfig, null, 2));

      const configService = ConfigService.getInstance();
      await configService.initialize();

      // Apply partial update to notifications only
      await configService.updateConfig({ interface: { notifications: { enabled: true } } });

      const after = configService.getConfig();
      // Language should remain as previously set
      expect(after.interface.language).toBe('zh');
      // Notifications should be merged in
      expect(after.interface.notifications?.enabled).toBe(true);

      // Verify file on disk also retains language and includes notifications
      const disk = JSON.parse(fs.readFileSync(path.join(cuiDir, 'config.json'), 'utf-8'));
      expect(disk.interface.language).toBe('zh');
      expect(disk.interface.notifications.enabled).toBe(true);
    });
  });
});