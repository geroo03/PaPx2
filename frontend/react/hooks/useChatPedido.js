/**
 * useChatPedido.js
 *
 * Custom hook para el chat en tiempo real de un pedido.
 * Implementa buffer de sincronización para evitar la race condition
 * entre el canal Realtime y el fetch del historial inicial.
 *
 * Esquema de la DB relevante:
 *   pedidos          → cliente_id, comercio_id, cadete_id
 *   profiles         → id (PK), role
 *   mensajes_pedido  → id, pedido_id, remitente_id, rol_remitente, mensaje, creado_at
 *
 * @param {string} pedidoId   UUID del pedido activo
 * @param {string} rolActual  Rol del usuario: 'cliente' | 'comercio' | 'cadete'
 *
 * @returns {{
 *   mensajes:      Array,
 *   loading:       boolean,
 *   error:         string|null,
 *   enviando:      boolean,
 *   enviarMensaje: (texto: string) => Promise<{ error: string|null }>
 * }}
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

// ─── Cliente Supabase ─────────────────────────────────────────────────────────
// Orden de prioridad para las variables de entorno:
//   1. window.sb     → cliente ya inicializado por el HTML vanilla (evita
//                       abrir una segunda conexión WebSocket para Realtime)
//   2. Vite          → import.meta.env.VITE_SUPABASE_*
//   3. CRA           → process.env.REACT_APP_SUPABASE_*
//   4. Capacitor / env.js → window.SUPABASE_*
//
// Para proyectos más grandes: mover a lib/supabaseClient.js y exportar el singleton.

function _getEnv(viteKey, craKey, windowKey) {
  if (typeof import.meta !== 'undefined' && import.meta.env?.[viteKey])
    return import.meta.env[viteKey];
  if (typeof process !== 'undefined' && process.env?.[craKey])
    return process.env[craKey];
  if (typeof window !== 'undefined' && window[windowKey])
    return window[windowKey];
  return '';
}

const _url = _getEnv('VITE_SUPABASE_URL',      'REACT_APP_SUPABASE_URL',      'SUPABASE_URL');
const _key = _getEnv('VITE_SUPABASE_ANON_KEY', 'REACT_APP_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY');

// Reutilizar window.sb si ya existe (evita doble conexión WebSocket con la app vanilla)
const supabase =
  (typeof window !== 'undefined' && window.sb) ||
  createClient(_url, _key);

// ─── Hook principal ───────────────────────────────────────────────────────────
export function useChatPedido(pedidoId, rolActual) {

  // ── Estado visible al componente ──────────────────────────────────────────
  const [mensajes, setMensajes] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [enviando, setEnviando] = useState(false);

  // ── Buffer de sincronización ──────────────────────────────────────────────
  //
  // PROBLEMA: El canal Realtime se suscribe antes del fetch para no perder
  // mensajes, pero los mensajes que llegan DURANTE el fetch causarían un estado
  // inconsistente si fueran al estado antes de que el historial esté listo.
  //
  // SOLUCIÓN — Patrón buffer de dos fases:
  //
  //   FASE 1 (fetchDone = false):
  //     Canal activo → cualquier INSERT entrante se acumula en `buffer`
  //
  //   FASE 2 (fetchDone = true, post-fetch):
  //     Fusión única: [...historial, ...buffer.filter(no duplicado)]
  //     A partir de ahí, los INSERTs van directo al estado.
  //
  // useRef → los cambios no causan re-render; solo son flags de control interno.
  const buffer    = useRef([]);     // acumulador temporal pre-fetch
  const fetchDone = useRef(false);  // flag: ¿completó el historial inicial?

  useEffect(() => {
    if (!pedidoId) return;

    // ── Reset al montar o cambiar de pedido ───────────────────────────────
    let activo        = true;
    buffer.current    = [];
    fetchDone.current = false;
    setMensajes([]);
    setError(null);
    setLoading(true);

    // ── PASO 1: Activar canal Realtime ANTES del fetch ────────────────────
    // Cualquier INSERT que llegue mientras el fetch está en vuelo va al buffer.
    const canal = supabase
      .channel(`chat-pedido-${pedidoId}`)
      .on(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          table:  'mensajes_pedido',
          filter: `pedido_id=eq.${pedidoId}`,
        },
        ({ new: msg }) => {
          if (!activo) return;

          if (!fetchDone.current) {
            // ── FASE 1: fetch todavía en vuelo → acumular en buffer ────────
            buffer.current.push(msg);
            return;
          }

          // ── FASE 2: fetch completo → agregar directo al estado (con dedup) ─
          setMensajes(prev =>
            prev.some(m => m.id === msg.id) ? prev : [...prev, msg]
          );
        }
      )
      .subscribe();

    // ── PASO 2: Fetch del historial inicial ───────────────────────────────
    // Filtra por pedido_id, orden cronológico ascendente.
    // Columnas: solo las necesarias para el render (no traer campos sensibles).
    const fetchHistorial = async () => {
      const { data: historial, error: fetchError } = await supabase
        .from('mensajes_pedido')
        .select('id, pedido_id, remitente_id, rol_remitente, mensaje, creado_at')
        .eq('pedido_id', pedidoId)
        .order('creado_at', { ascending: true });

      if (!activo) return;

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      const datos = historial ?? [];

      // ── PASO 3: FUSIÓN historial + buffer ─────────────────────────────────
      //
      // Set con todos los IDs del historial para la búsqueda O(1).
      const historialIds = new Set(datos.map(m => m.id));

      // Del buffer, conservar solo los mensajes que NO están en el historial.
      // (Evita duplicados si un mensaje llegó antes del cierre del fetch.)
      const bufferedNuevos = buffer.current
        .filter(m => !historialIds.has(m.id))
        .sort((a, b) => new Date(a.creado_at) - new Date(b.creado_at));

      // Estado inicial definitivo: historial completo + cola post-fetch sin dupes.
      setMensajes([...datos, ...bufferedNuevos]);

      // ── PASO 4: Activar FASE 2 ────────────────────────────────────────────
      fetchDone.current = true;
      buffer.current    = []; // liberar memoria
      setLoading(false);
    };

    fetchHistorial();

    // ── Cleanup al desmontar o cambiar pedidoId ───────────────────────────
    return () => {
      activo = false;
      supabase.removeChannel(canal);
    };
  }, [pedidoId]);

  // ── enviarMensaje ─────────────────────────────────────────────────────────
  const enviarMensaje = useCallback(async (texto) => {
    const trimmed = texto?.trim();
    if (!trimmed)   return { error: 'El mensaje no puede estar vacío.' };
    if (!pedidoId)  return { error: 'pedidoId no definido.' };
    if (!rolActual) return { error: 'rolActual no definido.' };

    setEnviando(true);
    setError(null);

    // Obtener el usuario de la sesión activa.
    // En la tabla pedidos, el comprador se identifica con cliente_id.
    // En la tabla profiles, el rol del usuario está en la columna role (inglés).
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      setEnviando(false);
      return { error: 'No autenticado. Volvé a iniciar sesión.' };
    }

    // ── REGLA DE ORO ──────────────────────────────────────────────────────
    // Este INSERT nunca modifica el estado `mensajes` manualmente.
    // Confiamos ciegamente en que el canal Realtime entregará el mensaje
    // una vez que Supabase confirme la escritura en la DB.
    // Ventaja: solo mensajes persistidos aparecen en pantalla; nunca
    // mensajes "optimistas" que podrían no haberse guardado.
    const { error: insertError } = await supabase
      .from('mensajes_pedido')
      .insert({
        pedido_id:     pedidoId,
        remitente_id:  user.id,
        rol_remitente: rolActual,  // validado también por la política RLS INSERT
        mensaje:       trimmed,
      });

    setEnviando(false);
    return { error: insertError?.message ?? null };
  }, [pedidoId, rolActual]);

  return { mensajes, loading, error, enviando, enviarMensaje };
}
