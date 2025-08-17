import React, { useState, useEffect } from 'react';
import { Bell, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { api } from '../../services/api';
import type { Preferences } from '../../types';

interface Props {
  prefs: Preferences;
  machineId: string;
  onUpdate: (updates: Partial<Preferences>) => Promise<void>;
}

export function NotificationTab({ prefs, machineId, onUpdate }: Props) {
  const [webPushStatus, setWebPushStatus] = useState<{
    enabled: boolean;
    subscriptionCount: number;
    hasPublicKey: boolean;
    publicKey?: string;
  } | null>(null);
  const [webPushSubscription, setWebPushSubscription] = useState<PushSubscription | null>(null);
  const [webPushLoading, setWebPushLoading] = useState(false);
  const [webPushError, setWebPushError] = useState<string>('');
  const [testSent, setTestSent] = useState(false);

  useEffect(() => {
    checkWebPushStatus();
    checkExistingSubscription();
  }, []);

  const checkWebPushStatus = async () => {
    try {
      const status = await api.getWebPushStatus();
      setWebPushStatus(status);
    } catch (error) {
      console.error('Failed to get web push status:', error);
    }
  };

  const checkExistingSubscription = async () => {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        setWebPushSubscription(subscription);
      } catch (error) {
        console.error('Failed to check existing subscription:', error);
      }
    }
  };

  const handleWebPushToggle = async () => {
    setWebPushLoading(true);
    setWebPushError('');
    
    try {
      if (webPushSubscription) {
        // Unsubscribe
        await webPushSubscription.unsubscribe();
        await api.unregisterWebPush(webPushSubscription.endpoint);
        setWebPushSubscription(null);
      } else {
        // Subscribe
        if (!('serviceWorker' in navigator)) {
          throw new Error('Service Worker not supported');
        }
        if (!('PushManager' in window)) {
          throw new Error('Push notifications not supported');
        }

        const registration = await navigator.serviceWorker.ready;
        
        if (!webPushStatus?.publicKey) {
          throw new Error('Server VAPID public key not available');
        }

        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: webPushStatus.publicKey
        });

        await api.registerWebPush(subscription);
        setWebPushSubscription(subscription);
      }
      
      await checkWebPushStatus();
    } catch (error: any) {
      console.error('Web push toggle error:', error);
      
      // Provide helpful error messages
      if (error.message?.includes('Service Worker not supported')) {
        setWebPushError('Service Worker not supported. Ensure you are using HTTPS or localhost.');
      } else if (error.message?.includes('Push notifications not supported')) {
        setWebPushError('Push notifications not supported in this browser.');
      } else if (error.name === 'NotAllowedError' || error.message?.includes('permission')) {
        setWebPushError('Notification permission denied. Please allow notifications in browser settings.');
      } else if (error.message?.includes('VAPID')) {
        setWebPushError('Server configuration issue. Please check server logs.');
      } else if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
        setWebPushError('Web Push requires HTTPS or localhost. For Safari, you also need to install as PWA.');
      } else {
        setWebPushError(error.message || 'Failed to enable web push notifications');
      }
    } finally {
      setWebPushLoading(false);
    }
  };

  const handleSendTest = async () => {
    try {
      setTestSent(false);
      const result = await api.sendTestNotification();
      if (result.success) {
        setTestSent(true);
        setTimeout(() => setTestSent(false), 3000);
      }
    } catch (error) {
      console.error('Failed to send test notification:', error);
    }
  };

  return (
    <div className="px-6 pb-6 overflow-y-auto h-full">
      {/* Main toggle section */}
      <div className="py-4 border-b border-neutral-200 dark:border-neutral-800">
        <div className="flex items-center justify-between min-h-[60px] py-2">
          <div className="flex-1 flex flex-col gap-1 mr-4">
            <Label htmlFor="notifications-switch" className="text-sm text-neutral-900 dark:text-neutral-100 font-normal">
              Enable Push Notifications
            </Label>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
              We support two methods for push notifications: Ntfy and Web Push
            </p>
          </div>
          <Switch
            id="notifications-switch"
            checked={prefs.notifications?.enabled || false}
            onCheckedChange={(checked) => onUpdate({
              notifications: {
                ...prefs.notifications,
                enabled: checked
              }
            })}
            aria-label="Toggle push notifications"
          />
        </div>
      </div>

      {/* Ntfy Section */}
      <div className="py-4 border-b border-neutral-200 dark:border-neutral-800">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Ntfy</h3>
          <Switch
            checked={prefs.notifications?.ntfy?.enabled || false}
            onCheckedChange={(checked) => onUpdate({
              notifications: {
                ...prefs.notifications,
                enabled: prefs.notifications?.enabled || false,
                ntfy: {
                  ...prefs.notifications?.ntfy,
                  enabled: checked
                }
              }
            })}
            disabled={!prefs.notifications?.enabled}
            aria-label="Toggle ntfy notifications"
          />
        </div>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-3">
          Ntfy works out of the box but opens notifications in the ntfy app. To receive push notifications, subscribe to the following <a href="https://ntfy.sh/" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">ntfy topic</a>:
        </p>
        
        <div className="space-y-4">
          <div>
            <Label className="text-xs text-neutral-600 dark:text-neutral-400 mb-2 block">Ntfy Topic</Label>
            <div className="bg-neutral-100 dark:bg-neutral-800 p-3 rounded-md font-mono text-sm border border-neutral-200 dark:border-neutral-700">
              {machineId ? `cui-${machineId}` : 'Loading...'}
            </div>
          </div>

          <div>
            <Label htmlFor="ntfy-url" className="text-xs text-neutral-600 dark:text-neutral-400 mb-2 block">
              Ntfy Server URL (Optional)
            </Label>
            <Input
              id="ntfy-url"
              type="url"
              className="bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600 focus:border-blue-500 dark:focus:border-blue-400"
              value={prefs.notifications?.ntfy?.url || ''}
              placeholder="https://ntfy.sh"
              onChange={(e) => onUpdate({
                notifications: {
                  ...prefs.notifications,
                  enabled: prefs.notifications?.enabled || false,
                  ntfy: {
                    ...prefs.notifications?.ntfy,
                    enabled: prefs.notifications?.ntfy?.enabled || false,
                    url: e.target.value || undefined
                  }
                }
              })}
              disabled={!prefs.notifications?.enabled || !prefs.notifications?.ntfy?.enabled}
              aria-label="Ntfy server URL"
            />
          </div>
        </div>
      </div>

      {/* Web Push Section */}
      <div className="py-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Web Push</h3>
          <Switch
            checked={prefs.notifications?.webPush?.enabled || false}
            onCheckedChange={(checked) => onUpdate({
              notifications: {
                ...prefs.notifications,
                enabled: prefs.notifications?.enabled || false,
                webPush: {
                  ...prefs.notifications?.webPush,
                  enabled: checked
                }
              }
            })}
            disabled={!prefs.notifications?.enabled}
            aria-label="Toggle web push notifications"
          />
        </div>
        <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
          Web Push requires HTTPS hosting. See setup instructions at{' '}
          <a 
            href="https://github.com/wbopan/cui?tab=readme-ov-file#notifications" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            github.com/wbopan/cui#notifications
          </a>
        </p>

        <div className="flex gap-3 mb-4">
          <Button
            onClick={handleWebPushToggle}
            disabled={webPushLoading || !prefs.notifications?.enabled || !prefs.notifications?.webPush?.enabled}
            variant="outline"
            className="flex items-center gap-2"
          >
            {webPushLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : webPushSubscription ? (
              <>
                <Bell className="h-4 w-4" />
                Disable
              </>
            ) : (
              <>
                <Bell className="h-4 w-4" />
                Enable
              </>
            )}
          </Button>

          <Button
            onClick={handleSendTest}
            disabled={!webPushSubscription || !prefs.notifications?.enabled || !prefs.notifications?.webPush?.enabled}
            variant="outline"
            className="flex items-center gap-2"
          >
            Send Test Notification
          </Button>
        </div>

        {webPushSubscription && (
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 mb-3">
            <CheckCircle className="h-4 w-4" />
            Web Push is enabled
          </div>
        )}

        {testSent && (
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 mb-3">
            <CheckCircle className="h-4 w-4" />
            Test notification sent successfully
          </div>
        )}

        {webPushError && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3 mb-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-red-600 dark:text-red-400">
                <p className="font-medium mb-1">Failed to enable Web Push</p>
                <p>{webPushError}</p>
                
                {/* Helpful troubleshooting tips */}
                {webPushError.includes('HTTPS') && (
                  <ul className="mt-2 space-y-1 text-xs">
                    <li>• Use HTTPS or localhost to enable Web Push</li>
                    <li>• For Safari, additionally install as PWA</li>
                  </ul>
                )}
                {webPushError.includes('permission') && (
                  <p className="mt-2 text-xs">
                    Check your browser notification settings and allow notifications for this site.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {webPushStatus && !webPushStatus.hasPublicKey && (
          <div className="text-sm text-amber-600 dark:text-amber-400">
            <AlertCircle className="h-4 w-4 inline mr-1" />
            Server VAPID keys not configured. Web Push will be auto-configured on first enable.
          </div>
        )}
      </div>
    </div>
  );
}