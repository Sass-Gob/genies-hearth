import { supabase } from './supabase';

// VAPID public key — must match the one in Supabase secrets
const VAPID_PUBLIC_KEY = 'BCnlGCqjRAf+hMH/MvHXMTEo48CdaJmHiW+hoe0gLM3v48NZGjwG2PRsTxzTTJN+zj+3esOM7UXpNmatlZouotM=';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function registerPush(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.log('Push notifications not supported');
    return false;
  }

  try {
    // Register service worker
    const registration = await navigator.serviceWorker.register('/sw.js');
    console.log('Service worker registered');

    // Wait for it to be ready
    await navigator.serviceWorker.ready;

    // Check existing subscription
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      // Request permission and subscribe
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        console.log('Push permission denied');
        return false;
      }

      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      console.log('Push subscription created');
    }

    // Save subscription to Supabase
    const subJSON = subscription.toJSON();
    const { error } = await supabase
      .from('push_subscriptions' as any)
      .upsert(
        {
          endpoint: subJSON.endpoint,
          keys: subJSON.keys,
        },
        { onConflict: 'endpoint' }
      );

    if (error) {
      console.error('Failed to save push subscription:', error);
      return false;
    }

    console.log('Push subscription saved');
    return true;
  } catch (err) {
    console.error('Push registration failed:', err);
    return false;
  }
}
