// assets/js/embajador.js
import { supabase } from './config.js';
import { sanitizeHTML, formatARS } from './ui.js';

const toastEl = document.getElementById('toast');
function toast(msg, dur = 3000){ if(!toastEl) return alert(msg); toastEl.textContent = msg; toastEl.style.display = 'block'; setTimeout(()=>toastEl.style.display='none', dur); }

const elMisComercios = document.getElementById('v-mis-comercios');
const elVentas = document.getElementById('v-ventas-totales');
const elGanancias = document.getElementById('v-mis-ganancias');
const listaComerciosEl = document.getElementById('lista-comercios');

const formAlta = document.getElementById('form-alta-comercio');
const btnAlta = document.getElementById('btn-alta');
const altaLoader = document.getElementById('alta-loader');

let currentUserId = null;

async function init(){
  // Obtener sesión y user id
  try{
    const { data } = await supabase.auth.getSession();
    const session = data?.session;
    currentUserId = session?.user?.id || null;
  }catch(e){ console.error('No session', e); }

  if(!currentUserId){ toast('Debes iniciar sesión como Embajador'); return; }

  // cargar métricas y lista
  await cargarMetricasEmbajador();
  attachForm();
}

function setLoadingAlta(on){ btnAlta.disabled = on; altaLoader.style.display = on ? 'inline-block' : 'none'; }

function attachForm(){
  formAlta.addEventListener('submit', async (ev)=>{
    ev.preventDefault();
    const nombre = document.getElementById('c-nombre').value.trim();
    const whatsapp = document.getElementById('c-whatsapp').value.trim();
    const direccion = document.getElementById('c-direccion').value.trim();
    const rubro = document.getElementById('c-rubro').value.trim();
    const email = document.getElementById('c-email').value.trim();
    if(!nombre || !direccion || !rubro){ toast('Completa los campos obligatorios'); return; }
    setLoadingAlta(true);
    try{
      // VALIDACIÓN: evitar duplicados por mismo nombre+direccion o mismo teléfono
      const dupQuery = supabase.from('comercios').select('id,nombre,direccion,telefono').or(
        `and(nombre.eq.${encodeURIComponent(nombre)},direccion.eq.${encodeURIComponent(direccion)})`,
        `telefono.eq.${encodeURIComponent(whatsapp)}`
      ).limit(1);
      // Note: supabase-js .or requires raw string; using .or above for best-effort. We'll run and inspect result.
      let dup = null;
      try{ const { data: dd, error: dErr } = await dupQuery; if(!dErr && dd && dd.length) dup = dd[0]; }catch(e){}
      if(dup){ toast('Ya existe un comercio similar: ' + (dup.nombre||'')); setLoadingAlta(false); return; }

      const payload = {
        nombre,
        telefono: whatsapp || null,
        direccion,
        categoria: rubro,
        email: email || null,
        creado_por_embajador_id: currentUserId,
        estado_registro: 'pendiente',
        created_at: new Date().toISOString()
      };
      const { data, error } = await supabase.from('comercios').insert([payload]);
      if(error){ console.error(error); toast('Error al crear comercio: '+error.message); }
      else{ toast('Comercio registrado correctamente'); formAlta.reset(); await cargarMetricasEmbajador(); }
    }catch(e){ console.error(e); toast('Error inesperado'); }
    finally{ setLoadingAlta(false); }
  });
}

export async function cargarMetricasEmbajador(){
  if(!currentUserId){
    // Try to get it synchronously if not initialized
    try{ const { data } = await supabase.auth.getSession(); currentUserId = data?.session?.user?.id; }catch{}
    if(!currentUserId) return;
  }

  // Loader state in list
  listaComerciosEl.innerHTML = '<div class="empty">Cargando...</div>';

  try{
    // 1) contar comercios
    const { data: comercios, error: cErr } = await supabase
      .from('comercios')
      .select('id, nombre, estado_registro, created_at, telefono, direccion')
      .eq('creado_por_embajador_id', currentUserId)
      .order('created_at', { ascending: false });
    if(cErr) throw cErr;

    const cantidad = comercios?.length || 0;
    elMisComercios.textContent = cantidad;

    // Render lista
    if(!cantidad){ listaComerciosEl.innerHTML = '<div class="empty">No registraste comercios aún.</div>'; }
    else{
      listaComerciosEl.innerHTML = comercios.map(c=>{
        const fecha = new Date(c.created_at).toLocaleDateString();
        return `<div class="card item"><div class="left"><div class="name">${sanitizeHTML(c.nombre)}</div><div class="meta">Alta: ${fecha}</div></div><div class="status ${sanitizeHTML(c.estado_registro)}">${sanitizeHTML(c.estado_registro)}</div></div>`;
      }).join('');
    }

    // 2) Pedidos entregados para comercios de este embajador -> sumar totales
    // Primero obtener ids de comercios
    const comercioIds = comercios.map(x=>x.id).filter(Boolean);
    let ventasTotales = 0;
    let gananciaTotal = 0;
    if(comercioIds.length){
      // traer pedidos entregados
      const { data: pedidos, error: pErr } = await supabase
        .from('pedidos')
        .select('id,total,estado,comercio_id')
        .in('comercio_id', comercioIds)
        .eq('estado', 'entregado');
      if(pErr) throw pErr;

      // Mapear comercios por id para acceder a created_at
      const comerciosById = (comercios||[]).reduce((acc,c)=>{ acc[c.id]=c; return acc; }, {});

      // Para cada pedido calcular la ganancia según antigüedad del comercio
      (pedidos || []).forEach(p => {
        const total = Number(p.total || 0);
        ventasTotales += total;
        const comercio = comerciosById[p.comercio_id];
        let meses = 9999;
        if(comercio && comercio.created_at){
          const created = new Date(comercio.created_at);
          const now = new Date();
          meses = Math.floor((now - created) / (1000*60*60*24*30));
        }
        // Regla: 5% del total si comercio < 6 meses; 2% si entre 7 y 12 meses; 0% si >12 meses
        let factor = 0;
        if(meses <= 6) factor = 0.05;
        else if(meses >=7 && meses <= 12) factor = 0.02;
        else factor = 0;
        gananciaTotal += total * factor;
      });
    }

    elVentas.textContent = formatARS(ventasTotales || 0);
    elGanancias.textContent = formatARS(gananciaTotal || 0);

    // 3) Cargar historial (últimos 50 eventos) para comercios creados por este embajador
    try{
      const { data: hist, error: hErr } = await supabase
        .from('comercios_historial')
        .select('id, comercio_id, embajador_id, usuario_id, accion, detalles, created_at')
        .in('comercio_id', comercioIds)
        .order('created_at', { ascending: false })
        .limit(50);
      if(hErr) throw hErr;
      const histEl = document.getElementById('historial-comercios');
      if(!hist || !hist.length){ histEl.innerHTML = '<div class="empty">Sin actividad reciente</div>'; }
      else{
        histEl.innerHTML = hist.map(h=>{
          const t = new Date(h.created_at).toLocaleString();
          const accion = sanitizeHTML(h.accion);
          const cid = sanitizeHTML(h.comercio_id);
          const detalles = sanitizeHTML(JSON.stringify(h.detalles || {}));
          return `<div class="card item"><div class="left"><div class="name">${accion} · Comercio ${cid}</div><div class="meta">${t}</div></div><div class="meta small">${detalles}</div></div>`;
        }).join('');
      }
    }catch(e){ console.warn('Error historial', e); }

  }catch(e){ console.error('Error metricas embajador', e); toast('Error cargando métricas'); listaComerciosEl.innerHTML = '<div class="empty">Error al cargar</div>'; }
}

// Auto-init
init();
