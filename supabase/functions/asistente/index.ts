/**
 * Edge Function `asistente` — chat de soporte con IA (Groq).
 *
 * ── Por qué existe este archivo ────────────────────────────────────────────
 * Esta función ya se llamaba desde `cliente.js` (enviarAsistente) y
 * `cadete.js` (enviarIACadete), pero NO estaba en el repo: CLAUDE.md §9 decía
 * que vivía solo en el Dashboard de Supabase. Al probarla en vivo (2026-09-07)
 * el endpoint devolvía `404 {"code":"NOT_FOUND"}` — ya no está desplegada. Por
 * eso el chat mostraba "Hubo un error de conexión" y nada más.
 *
 * Se reescribe acá, versionada en git, para que no vuelva a pasar que el único
 * ejemplar viva fuera del repo. Se buscó la implementación original en el
 * working tree y en toda la historia de git (`git log --all -S groq`): no
 * quedó ni una línea, así que esto es una reconstrucción, no una copia.
 *
 * ── Proveedor: Groq ───────────────────────────────────────────────────────
 * API compatible con OpenAI (`https://api.groq.com/openai/v1/`), con capa
 * gratuita. Se llama con `fetch` directo en vez de sumar un SDK: es una sola
 * llamada POST y en una Edge Function cada dependencia es arranque en frío.
 *
 * Modelo por defecto `openai/gpt-oss-120b`. Se puede cambiar sin tocar código
 * con el secret GROQ_MODEL.
 *
 * ⚠️ **Los IDs de modelo de Groq caducan.** Al escribir esto (2026-09-07) la
 * documentación pública todavía listaba `llama-3.3-70b-versatile` como modelo
 * de producción, pero la API devuelve `404 The model does not exist or you do
 * not have access to it` — Groq retiró la familia Llama. La lista real de lo
 * que hay disponible se pide con:
 *
 *   curl https://api.groq.com/openai/v1/models -H "Authorization: Bearer $GROQ_API_KEY"
 *
 * Si el chat empieza a dar 404/400 de modelo inexistente, es esto: pedir la
 * lista y actualizar el secret GROQ_MODEL. No hace falta redeployar.
 *
 * Alternativas medidas el 2026-09-07 con el prompt real de soporte:
 *   openai/gpt-oss-120b   256 tokens, 0.23 s   ← default, el mejor Y el más rápido
 *   openai/gpt-oss-20b    673 tokens, 0.66 s
 * (también hay qwen/qwen3.8-27b y groq/compound, sin probar acá)
 *
 * ── Deploy (paso manual, necesita la CLI de Supabase logueada) ─────────────
 *   supabase secrets set GROQ_API_KEY=gsk_...
 *   supabase functions deploy asistente
 *
 * ── Notas de diseño ───────────────────────────────────────────────────────
 * - CORS explícito, INCLUIDO en las respuestas de error. Sin esto, en la app
 *   nativa (origen `capacitor://localhost`) el navegador bloquea la respuesta
 *   antes de que el JS pueda leer el status, y cualquier error del servidor se
 *   ve como "error de conexión" — exactamente el síntoma que se reportó.
 * - Exige el JWT del usuario, no la anon key. La anon key es pública (viaja en
 *   frontend/env.js), así que sin este chequeo cualquiera podría quemar la
 *   cuota gratuita de Groq desde afuera de la app.
 * - Recorta el historial: el cliente acumula la conversación entera y la
 *   reenvía completa en cada consulta.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─── CORS ────────────────────────────────────────────────────────────────────

const ORIGENES_PERMITIDOS = new Set([
  'capacitor://localhost',      // app nativa Android/iOS (Capacitor)
  'http://localhost',           // WebView de Capacitor en algunas versiones
  'https://localhost',
  'https://pa-px2.vercel.app',  // frontend en producción
  'http://localhost:3000',      // desarrollo
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:8899',
]);

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin && ORIGENES_PERMITIDOS.has(origin) ? origin : 'https://pa-px2.vercel.app',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

// ─── Prompts por rol ─────────────────────────────────────────────────────────

const BASE = `Sos el asistente de soporte de "Puerta a Puerta X", una app de
delivery local de Argentina que conecta clientes con comercios de barrio y
cadetes (repartidores). Opera en Santiago del Estero, La Plata y Córdoba.

Cómo respondés:
- En español rioplatense, de vos. Cercano y directo, sin ser acartonado.
- BREVE: 2 a 4 oraciones. Si hace falta enumerar pasos, máximo 5 y cortos.
- Sin markdown pesado: nada de tablas ni encabezados. Como mucho **negrita**.

Límites que no cruzás:
- No tenés acceso a la base de datos: NO podés ver pedidos, saldos, montos ni
  estados concretos. Si te preguntan por un pedido puntual, decilo y explicá
  dónde lo puede ver en la app.
- Nunca prometas reembolsos, plazos de entrega ni excepciones. Eso lo decide
  una persona del equipo.
- Si el tema es un reclamo de plata, un accidente, o algo que no sabés con
  certeza, decilo y derivá al soporte humano en vez de inventar.
- Si te piden algo que no tiene que ver con la app, redirigí con amabilidad.`;

const PROMPTS: Record<string, string> = {
  usuario: `${BASE}

Estás hablando con un CLIENTE. Lo que necesitás saber:
- Para pedir: elige un comercio abierto, arma el carrito, marca en el mapa
  dónde entregar y confirma. Los comercios cerrados dejan ver el menú pero no
  reciben pedidos.
- Los precios que ve ya incluyen el recargo de la plataforma; no se suma nada
  después. El envío se calcula por distancia y se muestra antes de confirmar.
- Formas de pago: MercadoPago, efectivo o transferencia.
- Cuando el cadete llega, el cliente le dicta un código de entrega de 4
  dígitos que aparece en la pantalla de seguimiento. Ese código es la prueba
  de que el pedido llegó: no lo den antes de recibirlo.
- Puede seguir el pedido en vivo en el mapa una vez que el cadete lo retira.
- Si algo salió mal (no llegó, llegó en mal estado, faltó algo) puede abrir un
  reporte desde Soporte y se abre un chat con el comercio.
- Si quiere trabajar repartiendo, hay una opción "Convertite en Cadete" en su
  perfil.`,

  cadete: `${BASE}

Estás hablando con un CADETE. Lo que necesitás saber:
- Las ofertas de viaje llegan solas cuando está disponible y cerca del
  comercio. Cada oferta dura pocos segundos: si no la toma, pasa a otro.
- Qué tan seguido le llegan ofertas depende de la distancia al comercio, su
  rating y hace cuánto no recibe un viaje (hay rotación para repartir el
  trabajo, no es solo el más cercano).
- La ganancia se calcula por una base según el vehículo más un monto por
  kilómetro, redondeado. Cuando hay clima adverso se paga un plus.
- Flujo del viaje: acepta, va al comercio, el comercio le dicta el código de
  retiro, lleva el pedido, el cliente le dicta el código de entrega. Sin esos
  códigos el viaje no avanza.
- Si cobra en efectivo, esa plata queda registrada como deuda con la
  plataforma hasta que la liquide desde la sección de Ganancias.
- Si el cliente no aparece, existe la opción de reportar que no estaba; no lo
  use antes de esperar el tiempo que indica la app.`,

  comercio: `${BASE}

Estás hablando con un COMERCIO. Lo que necesitás saber:
- Cuando entra un pedido lo acepta declarando cuántos minutos va a tardar en
  prepararlo. Ese dato es el que hace que el cadete llegue justo cuando la
  comida está lista, así que conviene ser realista.
- El cadete lo busca solo el sistema; igual hay un botón para forzar la
  búsqueda si hace falta.
- Puede editar los productos de un pedido (sacar algo que se agotó, cambiar
  cantidades) antes de que el cadete lo retire, salvo que ya se haya pagado
  con MercadoPago.
- Cobra el 100% del precio que carga en su menú. La comisión de la plataforma
  se suma aparte, del lado del cliente.
- En los pedidos cobrados en efectivo, la comisión queda como deuda del
  comercio con la plataforma.
- Puede configurar horarios de apertura y cierre, pausar el local a mano, y
  cargar cierres especiales por fecha (feriados, vacaciones).`,
};

// ─── Handler ─────────────────────────────────────────────────────────────────

const GROQ_URL      = 'https://api.groq.com/openai/v1/chat/completions';
const MODELO_DEFECTO = 'openai/gpt-oss-120b';
const MAX_MENSAJES  = 10;    // últimos N turnos que se reenvían al modelo
const MAX_CHARS     = 2000;  // por mensaje

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Método no permitido.' }, 405, origin);
  }

  try {
    // ── 1. Autenticación: tiene que ser un usuario logueado de verdad ───────
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) {
      return json({ error: 'Falta el token de sesión.' }, 401, origin);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      // Pasa cuando mandan la anon key en vez del access_token de la sesión.
      return json({ error: 'Sesión inválida. Volvé a iniciar sesión.' }, 401, origin);
    }

    // ── 2. Validación del body ──────────────────────────────────────────────
    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.messages)) {
      return json({ error: 'Body inválido: falta "messages".' }, 400, origin);
    }

    const esTurnoValido = (m: unknown): m is { role: string; content: string } => {
      if (!m || typeof m !== 'object') return false;
      const t = m as { role?: unknown; content?: unknown };
      return (t.role === 'user' || t.role === 'assistant')
        && typeof t.content === 'string'
        && t.content.trim().length > 0;
    };

    const historial = body.messages
      .filter(esTurnoValido)
      .slice(-MAX_MENSAJES)
      .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));

    if (!historial.length) {
      return json({ error: 'No hay ningún mensaje para responder.' }, 400, origin);
    }

    const rol = typeof body.rol === 'string' && PROMPTS[body.rol] ? body.rol : 'usuario';

    // ── 3. Llamada a Groq (formato OpenAI) ──────────────────────────────────
    const apiKey = Deno.env.get('GROQ_API_KEY');
    if (!apiKey) {
      console.error('[asistente] Falta el secret GROQ_API_KEY');
      return json({ error: 'El asistente no está configurado.' }, 503, origin);
    }

    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: Deno.env.get('GROQ_MODEL') ?? MODELO_DEFECTO,
        messages: [{ role: 'system', content: PROMPTS[rol] }, ...historial],
        // Respuestas de soporte: cortas. Un techo bajo también acota el gasto
        // de cuota gratuita por consulta.
        max_tokens: 600,
        temperature: 0.6,
      }),
    });

    if (!res.ok) {
      const detalle = await res.text().catch(() => '');
      console.error('[asistente] Groq respondió', res.status, detalle.slice(0, 500));
      // 429 es el caso realista con la capa gratuita: conviene decirlo distinto
      // a "se rompió", porque se resuelve solo esperando.
      const mensaje = res.status === 429
        ? 'El asistente está recibiendo muchas consultas. Probá de nuevo en un minuto.'
        : 'El asistente no está disponible en este momento.';
      return json({ error: mensaje }, res.status === 429 ? 429 : 502, origin);
    }

    const data = await res.json();
    const texto = data?.choices?.[0]?.message?.content?.trim();

    return json({ respuesta: texto || 'No pude armar una respuesta. Probá preguntarlo de otra forma.' }, 200, origin);

  } catch (e) {
    console.error('[asistente] Error:', e instanceof Error ? e.message : e);
    return json({ error: 'El asistente no está disponible en este momento.' }, 500, origin);
  }
});
