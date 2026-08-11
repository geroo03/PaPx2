/**
 * horariosScheduler.js
 *
 * Automatiza comercios.abierto_ahora a partir del horario que el comercio ya
 * puede configurar (horario_apertura/horario_cierre/dias_abierto) — antes
 * ese horario no lo leía nadie, y abierto_ahora dependía 100% de que el
 * comercio se acordara de tocar un switch todos los días.
 *
 * Si el comercio nunca configuró horario (algún campo en NULL), este job no
 * lo toca — sigue siendo 100% manual como antes (cero regresión).
 *
 * pausado_manual es una pausa temporal ("me quedé sin stock") que gana por
 * sobre el horario mientras esté activa, y se limpia sola en cuanto pasa al
 * menos un día calendario (Argentina) desde que se activó — así no repite el
 * problema de "se olvidaron de reactivarlo y quedó cerrado para siempre".
 *
 * cierres_especiales (feriados, vacaciones, etc.) funciona igual que
 * pausado_manual pero sin necesitar limpieza propia: el chequeo es siempre
 * "¿hay una fila con fecha = hoy?", así que al otro día deja de aplicar
 * solo. Mismo alcance que pausado_manual: solo corre para comercios con
 * horario configurado (los 100% manuales quedan sin tocar).
 *
 * Corre dentro del propio proceso Node de Railway (persistente, no
 * serverless) — mismo patrón que matchingScheduler.js, sin infraestructura
 * de cron nueva.
 */

import { supabaseAdmin } from '../lib/supabaseClient.js';

const TICK_MS = 60_000;
const TZ = 'America/Argentina/Buenos_Aires';
const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

let corriendo = false;
const avisadosCruceMedianoche = new Set();

/**
 * Devuelve un Date cuyos GETTERS (getDay/getHours/getMinutes/getFullYear/
 * getMonth/getDate) reflejan la hora de Argentina — NO usar .toISOString()
 * ni .getTime() sobre este objeto, siguen reflejando el reloj real del
 * proceso, no el de Argentina.
 */
function ahoraEnArgentina() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
}

function pad2(n) { return String(n).padStart(2, '0'); }

function hoyISO(ahora) {
  return `${ahora.getFullYear()}-${pad2(ahora.getMonth() + 1)}-${pad2(ahora.getDate())}`;
}

function horaHHMM(ahora) {
  return `${pad2(ahora.getHours())}:${pad2(ahora.getMinutes())}`;
}

async function tickHorarios() {
  if (corriendo) return;
  corriendo = true;
  try {
    const { data: comercios, error } = await supabaseAdmin
      .from('comercios')
      .select('id, abierto_ahora, pausado_manual, pausado_desde, horario_apertura, horario_cierre, dias_abierto')
      .eq('estado_registro', 'activo')
      .not('horario_apertura', 'is', null)
      .not('horario_cierre', 'is', null)
      .not('dias_abierto', 'is', null);

    if (error) {
      console.error('[horariosScheduler] Error leyendo comercios:', error.message);
      return;
    }
    if (!comercios?.length) return;

    const ahora = ahoraEnArgentina();
    const diaHoy = DIAS[ahora.getDay()];
    const horaHoy = horaHHMM(ahora);
    const hoy = hoyISO(ahora);

    const { data: cierresHoy, error: cierresError } = await supabaseAdmin
      .from('cierres_especiales')
      .select('comercio_id')
      .in('comercio_id', comercios.map(c => c.id))
      .eq('fecha', hoy);

    if (cierresError) {
      console.error('[horariosScheduler] Error leyendo cierres_especiales:', cierresError.message);
    }
    const comerciosCerradosHoy = new Set((cierresHoy || []).map(c => c.comercio_id));

    for (const c of comercios) {
      // horario_apertura/horario_cierre vienen de Postgres como "HH:MM:SS"
      const apertura = String(c.horario_apertura).slice(0, 5);
      const cierre   = String(c.horario_cierre).slice(0, 5);

      if (cierre <= apertura) {
        // Cruza medianoche — no soportado en esta v1 (ver plan). Se deja el
        // comercio sin tocar (sigue en manual) en vez de calcular mal.
        if (!avisadosCruceMedianoche.has(c.id)) {
          console.warn(`[horariosScheduler] Comercio ${c.id}: horario_cierre (${cierre}) <= horario_apertura (${apertura}) — cruza medianoche, no soportado, se deja en manual.`);
          avisadosCruceMedianoche.add(c.id);
        }
        continue;
      }

      const dentroDia     = Array.isArray(c.dias_abierto) && c.dias_abierto.includes(diaHoy);
      const dentroHorario = horaHoy >= apertura && horaHoy < cierre;
      const cierreEspecialHoy = comerciosCerradosHoy.has(c.id);
      const calculadoAbierto = dentroDia && dentroHorario && !cierreEspecialHoy;

      let pausadoManual = !!c.pausado_manual;
      let pausadoDesde  = c.pausado_desde;

      if (pausadoManual && pausadoDesde && pausadoDesde !== hoy) {
        // Ya pasó al menos un día calendario desde que se pausó → se limpia sola.
        pausadoManual = false;
        pausadoDesde  = null;
      }

      const abiertoFinal = calculadoAbierto && !pausadoManual;

      const cambioAbierto = abiertoFinal !== !!c.abierto_ahora;
      const cambioPausa   = pausadoManual !== !!c.pausado_manual || pausadoDesde !== c.pausado_desde;

      if (cambioAbierto || cambioPausa) {
        const { error: updErr } = await supabaseAdmin
          .from('comercios')
          .update({ abierto_ahora: abiertoFinal, pausado_manual: pausadoManual, pausado_desde: pausadoDesde })
          .eq('id', c.id);

        if (updErr) {
          console.error(`[horariosScheduler] Error actualizando comercio ${c.id}:`, updErr.message);
        }
      }
    }
  } catch (e) {
    console.error('[horariosScheduler] Error inesperado en tick:', e?.message ?? e);
  } finally {
    corriendo = false;
  }
}

/** Arranca el scheduler. Llamar una sola vez desde server.js. */
export function iniciarSchedulerHorarios() {
  if (!supabaseAdmin) {
    console.warn('[horariosScheduler] supabaseAdmin no inicializado — scheduler NO arrancado.');
    return;
  }
  setInterval(tickHorarios, TICK_MS);
  console.log(`[horariosScheduler] Arrancado — horarios cada ${TICK_MS / 1000}s.`);
}
