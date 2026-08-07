// Lightweight Supabase auth wrapper (production - browser globals)
// This file intentionally contains NO service-role secrets. It uses the global `window.supabase` client provided by the CDN.

// Google bloquea el login OAuth dentro del WebView embebido de la app nativa
// (user-agent no permitido). La solución estándar de Capacitor es abrir el
// flujo en un navegador in-app (Custom Tabs) y volver a la app vía deep link
// cuando Google termina. Este esquema debe estar cargado también en Supabase
// Dashboard → Authentication → URL Configuration → Redirect URLs.
// Nota: este proyecto no usa bundler para el frontend, así que los plugins de
// Capacitor se acceden via window.Capacitor.Plugins (mismo patrón que push.js),
// no con `import` de los paquetes npm.
const OAUTH_NATIVE_REDIRECT = 'com.puertaapuertax.app://oauth-callback';
const isNative = () => typeof window !== 'undefined' && !!(window.Capacitor?.isNativePlatform?.());

let sbClient = null;
export function initAuthClient() {
  if (!sbClient) {
    // window.sb es el cliente real (createClient(...)) en todas las páginas de
    // este proyecto. window.supabase suele ser el namespace del SDK (con
    // .createClient) cuando se carga por CDN — no un cliente usable — así que
    // se prioriza window.sb primero.
    sbClient = window.sb || window.supabase || null;
    if (!sbClient) console.warn('auth-service: no supabase client available; ensure supabase is loaded via CDN');
  }
  return sbClient;
}

// Login con Google que funciona tanto en web (redirect normal) como en la
// app nativa Android (abre un navegador in-app y vuelve por deep link).
// `redirectPathWeb` es la ruta relativa a donde volver en la versión web
// (ej: '/cadete/cadete.html').
export async function iniciarLoginGoogleNativo(redirectPathWeb) {
  if (!sbClient) initAuthClient();

  if (isNative()) {
    const { Browser } = window.Capacitor.Plugins;
    const { data, error } = await sbClient.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: OAUTH_NATIVE_REDIRECT,
        skipBrowserRedirect: true,
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) throw error;
    if (!data?.url) throw new Error('Supabase no devolvió la URL de login de Google.');
    await Browser.open({ url: data.url });
    return;
  }

  const { error } = await sbClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + redirectPathWeb,
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) throw error;
}

// Registra el listener que recibe el deep link cuando Google termina el login
// (solo hace algo en la app nativa). Llamar UNA vez por página que use
// iniciarLoginGoogleNativo, antes de que el usuario toque el botón de Google.
// `onSuccess` se llama después de setSession() — normalmente para navegar a
// la pantalla correspondiente.
export function escucharCallbackOAuthNativo(onSuccess) {
  if (!isNative()) return;
  if (!sbClient) initAuthClient();

  const { Browser, App } = window.Capacitor.Plugins;

  App.addListener('appUrlOpen', async ({ url }) => {
    if (!url || !url.startsWith(OAUTH_NATIVE_REDIRECT)) return;

    try {
      const fragment = url.split('#')[1] || '';
      const params = new URLSearchParams(fragment);
      const access_token  = params.get('access_token');
      const refresh_token = params.get('refresh_token');

      if (!access_token || !refresh_token) {
        console.error('[OAuth nativo] Callback sin tokens:', url);
        return;
      }

      const { data, error } = await sbClient.auth.setSession({ access_token, refresh_token });
      if (error) throw error;
      onSuccess?.(data?.session ?? null);
    } catch (err) {
      console.error('[OAuth nativo] Error procesando callback:', err?.message ?? err);
    } finally {
      Browser?.close().catch(() => {});
    }
  });
}

// Expose a tiny global bridge for pages that rely on window.authService
if (typeof window !== 'undefined') {
  window.authService = window.authService || {};
  window.authService.iniciarLoginGoogleNativo = iniciarLoginGoogleNativo;
}
