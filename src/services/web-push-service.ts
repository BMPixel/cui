import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import webpush, { PushSubscription } from 'web-push';
import { createLogger, type Logger } from './logger.js';
import { ConfigService } from './config-service.js';

export interface WebPushPayload {
  title: string;
  message: string;
  tag?: string;
  data?: Record<string, unknown>;
}

interface SubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string;
  created_at: string;
  last_seen: string;
  expired: number;
}

export class WebPushService {
  private static instance: WebPushService;
  private logger: Logger;
  private db!: Database.Database;
  private dbPath!: string;
  private configDir!: string;
  private isInitialized = false;
  private configService: ConfigService;

  private insertStmt!: Database.Statement;
  private deleteStmt!: Database.Statement;
  private upsertSeenStmt!: Database.Statement;
  private listStmt!: Database.Statement;
  private countStmt!: Database.Statement;

  private constructor(customConfigDir?: string) {
    this.logger = createLogger('WebPushService');
    this.configService = ConfigService.getInstance();
    this.initializePaths(customConfigDir);
  }

  static getInstance(): WebPushService {
    if (!WebPushService.instance) {
      WebPushService.instance = new WebPushService();
    }
    return WebPushService.instance;
  }

  private initializePaths(customConfigDir?: string): void {
    const baseConfigDir = customConfigDir || path.join(os.homedir(), '.cui');
    this.configDir = baseConfigDir;
    this.dbPath = path.join(baseConfigDir, 'web-push.db');
    this.logger.debug('Initialized web push database paths', {
      dir: this.configDir,
      dbPath: this.dbPath,
    });
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    try {
      if (this.dbPath !== ':memory:' && !fs.existsSync(this.configDir)) {
        fs.mkdirSync(this.configDir, { recursive: true });
      }
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS subscriptions (
          endpoint TEXT PRIMARY KEY,
          p256dh TEXT NOT NULL,
          auth TEXT NOT NULL,
          user_agent TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          last_seen TEXT NOT NULL,
          expired INTEGER NOT NULL DEFAULT 0
        );
      `);

      this.prepareStatements();
      this.configureVapid();
      this.isInitialized = true;
    } catch (error) {
      this.logger.error('Failed to initialize web push database', error);
      throw new Error(`WebPush database initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private prepareStatements(): void {
    this.insertStmt = this.db.prepare(
      'INSERT OR REPLACE INTO subscriptions (endpoint, p256dh, auth, user_agent, created_at, last_seen, expired) VALUES (?, ?, ?, ?, COALESCE((SELECT created_at FROM subscriptions WHERE endpoint = ?), ?), ?, 0)'
    );
    this.deleteStmt = this.db.prepare('DELETE FROM subscriptions WHERE endpoint = ?');
    this.upsertSeenStmt = this.db.prepare('UPDATE subscriptions SET last_seen = ?, expired = ? WHERE endpoint = ?');
    this.listStmt = this.db.prepare('SELECT * FROM subscriptions WHERE expired = 0');
    this.countStmt = this.db.prepare('SELECT COUNT(*) as count FROM subscriptions WHERE expired = 0');
  }

  private configureVapid(): void {
    const config = this.configService.getConfig();
    let subject = config.interface.notifications?.webPush?.subject || 'mailto:admin@example.com';
    let publicKey = config.interface.notifications?.webPush?.vapidPublicKey;
    let privateKey = config.interface.notifications?.webPush?.vapidPrivateKey;

    // Auto-generate VAPID keys if missing and notifications enabled
    let generated = false;
    if (this.getEnabled() && (!publicKey || !privateKey)) {
      try {
        const keys = webpush.generateVAPIDKeys();
        publicKey = keys.publicKey;
        privateKey = keys.privateKey;
        // Persist into config (partial update preserves other interface fields)
        void this.configService.updateConfig({
          interface: {
            ...config.interface,
            notifications: {
              ...(config.interface.notifications || { enabled: true }),
              webPush: {
                subject,
                vapidPublicKey: publicKey,
                vapidPrivateKey: privateKey,
              },
            },
          },
        }).catch((_err: unknown) => {
          this.logger.warn('Failed to persist generated VAPID keys to config');
        });
        this.logger.info('Generated and applied VAPID keys');
        generated = true;
      } catch (_e) {
        this.logger.error('Failed to generate VAPID keys');
      }
    }

    if (!publicKey || !privateKey) {
      this.logger.warn('Web Push VAPID keys are not configured. Native push will be disabled until set in config');
      return;
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);

    // If keys were generated just now, expire existing subscriptions to force re-register
    if (generated) {
      try {
        this.db.prepare('UPDATE subscriptions SET expired = 1').run();
        this.logger.info('Expired all existing web push subscriptions due to VAPID key generation');
      } catch (_e) {
        this.logger.warn('Failed to expire existing subscriptions after VAPID key generation');
      }
    }
  }

  getPublicKey(): string | null {
    const publicKey = this.configService.getConfig().interface.notifications?.webPush?.vapidPublicKey || null;
    return publicKey || null;
  }

  getEnabled(): boolean {
    const notifications = this.configService.getConfig().interface.notifications;
    const globalEnabled = notifications?.enabled ?? false;
    const webPushEnabled = notifications?.webPush?.enabled ?? true; // Default to true for backward compatibility
    return globalEnabled && webPushEnabled;
  }

  getSubscriptionCount(): number {
    const row = this.countStmt.get() as { count: number };
    return row?.count || 0;
  }

  addOrUpdateSubscription(subscription: PushSubscription, userAgent = ''): void {
    const now = new Date().toISOString();
    const { endpoint, keys } = subscription as unknown as { endpoint: string; keys: { p256dh: string; auth: string } };
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      throw new Error('Invalid subscription payload: missing endpoint/keys');
    }

    this.insertStmt.run(endpoint, keys.p256dh, keys.auth, userAgent || '', endpoint, now, now);
  }

  removeSubscriptionByEndpoint(endpoint: string): void {
    this.deleteStmt.run(endpoint);
  }

  listSubscriptions(): SubscriptionRow[] {
    return this.listStmt.all() as SubscriptionRow[];
  }

  async broadcast(payload: WebPushPayload): Promise<{ sent: number; failed: number }>{
    await this.initialize();
    const subs = this.listSubscriptions();
    let sent = 0;
    let failed = 0;
    await Promise.all(
      subs.map(async (row) => {
        const sub: PushSubscription = {
          endpoint: row.endpoint,
          expirationTime: null,
          keys: { p256dh: row.p256dh, auth: row.auth },
        } as unknown as PushSubscription;
        try {
          await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 60 });
          this.upsertSeenStmt.run(new Date().toISOString(), 0, row.endpoint);
          sent += 1;
        } catch (err: unknown) {
          failed += 1;
          // 410 Gone or 404 Not Found => expire subscription
          const status = (err as any)?.statusCode || (err as any)?.response?.statusCode;
          if (status === 404 || status === 410) {
            this.upsertSeenStmt.run(new Date().toISOString(), 1, row.endpoint);
            this.logger.info('Expired web push subscription removed', { endpoint: row.endpoint, status });
          } else {
            this.logger.error('Failed sending web push notification', { 
              endpoint: row.endpoint, 
              statusCode: status,
              error: err instanceof Error ? err.message : String(err)
            });
          }
        }
      })
    );
    return { sent, failed };
  }
}


