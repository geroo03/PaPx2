const VAPID_KEY = window.VAPID_PUBLIC_KEY || '';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export async function registrarPush() {
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

    const sb = window.sb;
    if (!sb) return;
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;

    const { data: perfil } = await sb.from('perfiles').select('rol').eq('usuario_id', user.id).maybeSingle();
    const rol = perfil?.rol || 'cliente';

    await sb.from('fcm_tokens').upsert(
      { user_id: user.id, token: JSON.stringify(sub), rol },
      { onConflict: 'token' },
    );
  } catch (e) {
    console.warn('[Push] Error registrando:', e.message);
  }
}
