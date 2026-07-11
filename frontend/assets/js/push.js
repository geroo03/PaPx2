// push.js — notificaciones push
// Web: usa Service Worker + VAPID
// Nativa (Capacitor): usa FCM a través de @capacitor/push-notifications

const VAPID_KEY = window.VAPID_PUBLIC_KEY || '';

const isNative = () =>
  typeof window !== 'undefined' &&
  !!(window.Capacitor?.isNativePlatform?.());

// ─── NATIVA (Capacitor / FCM) ────────────────────────────────────────────────

async function registrarPushNativa() {
  try {
    const { PushNotifications } = window.Capacitor.Plugins;
    if (!PushNotifications) return;

    const permResult = await PushNotifications.requestPermissions();
    if (permResult.receive !== 'granted') return;

    await PushNotifications.register();

    PushNotifications.addListener('registration', async ({ value: token }) => {
      await _guardarToken(token, 'fcm');
    });

    PushNotifications.addListener('registrationError', err => {
      console.warn('[Push] Error registro FCM:', err.error);
    });

    PushNotifications.addListener('pushNotificationReceived', notification => {
      console.log('[Push] Notificación recibida en foreground:', notification);
    });

    PushNotifications.addListener('pushNotificationActionPerformed', action => {
      const data = action.notification?.data ?? {};
      if (data.url) window.location.href = data.url;
    });
  } catch (e) {
    console.warn('[Push] Error en setup nativo:', e.message);
  }
}

// ─── WEB (Service Worker + VAPID) ────────────────────────────────────────────

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function registrarPushWeb() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !VAPID_KEY) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return;
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_KEY),
      });
    }
    await _guardarToken(JSON.stringify(sub), 'vapid');
  } catch (e) {
    console.warn('[Push] Error registrando web push:', e.message);
  }
}

// ─── COMÚN ───────────────────────────────────────────────────────────────────

async function _guardarToken(token, tipo) {
  const sb = window.sb;
  if (!sb) return;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  const { data: perfil } = await sb.from('perfiles').select('rol').eq('usuario_id', user.id).maybeSingle();
  const rol = perfil?.rol || 'cliente';
  await sb.from('fcm_tokens').upsert(
    { user_id: user.id, token, rol },
    { onConflict: 'token' },
  );
}

// ─── EXPORT ───────────────────────────────────────────────────────────────────

export async function registrarPush() {
  if (isNative()) {
    await registrarPushNativa();
  } else {
    await registrarPushWeb();
  }
}
