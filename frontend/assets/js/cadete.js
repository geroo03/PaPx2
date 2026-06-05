import { ICONS } from './icons.js';

let disp = true, viajes = [], codsIngresados = {};

// Active trip UI state machine
// 0 = Sin viajes, 1 = Asignado / Yendo al Local, 2 = Retirado / En Camino al Cliente, 3 = Finalizado
let activeTrip = null;
let activeTripState = 0;

// Expose flag for debugging
window._cadete_activeTripState = () => ({ activeTripState, activeTrip });

function toast(m,d=2500){const t=document.getElementById('toast');t.innerHTML=m;t.style.display='block';setTimeout(()=>t.style.display='none',d);}
function stab(tab){document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));document.querySelectorAll('.sec').forEach(s=>s.classList.remove('active'));document.getElementById('tab-'+tab).classList.add('active');document.getElementById('sec-'+tab).classList.add('active');}
function aN(id){document.querySelectorAll('.ni').forEach(n=>n.classList.remove('active'));document.getElementById(id).classList.add('active');}

function togDisp(){
  disp=!disp;
  document.getElementById('disp-dot').className='disp-dot'+(disp?' on':'');
  document.getElementById('disp-lbl').textContent=disp?'Disponible':'Inactivo';
  toast(disp?'✅ Estás disponible':'⏸️ Pausaste los viajes');
  renderViajes();
}

function genCod(pedId){
  const seed=pedId.split('').reduce((a,c)=>a+c.charCodeAt(0),0);
  return String((seed*7+1337)%9000+1000);
}

async function cargarViajes(){
  try{
    const{data}=await sb.from('pedidos').select('*,comercios(nombre,direccion)').eq('tipo_delivery','app').in('estado',['preparando','en_camino']).order('created_at',{ascending:false});
    viajes=data||[];
  }catch{
    viajes=[{id:'v1',numero:1043,estado:'preparando',tipo_delivery:'app',items:[{nombre:'Pizza Muzarella',qty:1,precio:2500}],total:5700,direccion_entrega:'Urquiza 456, Santiago del Estero',created_at:new Date().toISOString(),comercios:{nombre:'La Piola Pizzería',direccion:'Av. Belgrano 234'}}];
  }
  renderViajes();actualizarStats();
}

function renderViajes(){
  const container=document.getElementById('viajes-container');
  if(!disp){container.innerHTML='<div class="no-disp"><div class="big">' + ICONS.warn + '</div><h3>Estás inactivo</h3><p>Activate para recibir viajes.</p><button class="btn-activar" onclick="togDisp()">Activarme ahora</button></div>';return;}
  // If there is a selected activeTrip use it; otherwise show empty or list
  if (!activeTrip) {
    // show empty state (state 0)
  container.innerHTML = '<div class="empty"><div class="big">' + ICONS.scooter + '</div><p>No hay viajes disponibles.<br/>Cuando lleguen aparecen acá.</p></div>';
    // update badge
    const nuevos = viajes.filter(v => v.estado === 'preparando').length;
    const bn = document.getElementById('bn'); bn.style.display = nuevos > 0 ? 'inline-flex' : 'none'; bn.textContent = nuevos;
    activeTripState = 0; return;
  }

  // Render based on activeTripState
  const v = activeTrip;
  const hr = new Date(v.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  const earn = Math.round(Number(v.costo_envio || 800) * 0.75);
  const comercioNombre = v.comercios?.nombre || 'Comercio';
  const comercioDireccion = v.comercios?.direccion || 'Dirección del local';
  const comercioTelefono = v.comercios?.telefono || '';
  const clienteNombre = v.cliente_nombre || v.cliente?.nombre || 'Cliente';
  const clienteDireccion = v.direccion_entrega || v.cliente?.direccion || 'Dirección del cliente';
  const clienteTelefono = v.cliente_telefono || v.cliente?.telefono || '';
  const metodoPago = v.metodo_pago || v.pago || 'Efectivo';
  const total = v.total || v.monto || 0;

  // Helper to create maps URL
  const mapsTo = (addr) => 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(addr);

  // Floating alert button markup helper
  const alertBtnHtml = `<button id="viaje-alert-btn" style="position:fixed;right:18px;bottom:140px;z-index:1400;width:54px;height:54px;border-radius:999px;background:#fff;border:1px solid rgba(0,0,0,.06);display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 10px 30px rgba(0,0,0,.12);">${ICONS.warn}</button>`;

  if (activeTripState === 1) {
    container.innerHTML = `
      <div class="viaje-card nuevo" style="background:linear-gradient(180deg,#0F1720,#0B1220);padding:14px;border-radius:12px;color:#fff;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><div><div style="font-size:13px;font-weight:800;">${comercioNombre}</div><div style="font-size:12px;color:#cfcfcf;margin-top:4px;">${comercioDireccion}</div><div style="font-size:12px;color:#cfcfcf;margin-top:4px;">${comercioTelefono}</div></div><div style="text-align:right;color:#9CA3AF;font-size:12px;">${hr}</div></div>
        <div style="display:flex;gap:10px;margin-top:12px;">
          <a class="btn-o" href="${mapsTo(comercioDireccion)}" target="_blank" style="flex:1;padding:14px;border-radius:10px;background:transparent;border:1px solid rgba(255,255,255,0.06);color:#fff;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;font-weight:800;">${ICONS.pin} Ver ruta al Local</a>
          <button id="btn-llegue-local" class="btn-g" style="flex:1;background:linear-gradient(135deg,#FF6B35,#E55A27);color:#fff;border:none;border-radius:10px;padding:14px;font-weight:800;">¡Llegué al Local!</button>
        </div>
      </div>
    `;
    // append alert button
    document.body.insertAdjacentHTML('beforeend', alertBtnHtml);
    document.getElementById('viaje-alert-btn')?.addEventListener('click', ()=>{
      if(confirm('¿Deseas reportar un problema con este viaje al administrador?')){ toast('Reporte enviado.'); }
    });
    // attach action
    document.getElementById('btn-llegue-local')?.addEventListener('click', ()=>{ markArrivedAtLocal(); });
    return;
  }

  if (activeTripState === 2) {
    container.innerHTML = `
      <div class="viaje-card activo" style="background:linear-gradient(180deg,#081018,#061018);padding:14px;border-radius:12px;color:#fff;">
        <div style="font-size:13px;font-weight:800;margin-bottom:6px;">Entregás a: ${clienteNombre}</div>
        <div style="font-size:12px;color:#cfcfcf;margin-bottom:6px;">${clienteDireccion}</div>
        <div style="display:flex;gap:8px;color:#cfcfcf;font-size:13px;margin-bottom:12px;"><div>Tel: ${clienteTelefono||'—'}</div><div>Pago: ${metodoPago} ${metodoPago==='Efectivo' ? `· $${total}` : ''}</div></div>
        <div style="display:flex;gap:10px;">
          <a class="btn-o" href="${mapsTo(clienteDireccion)}" target="_blank" style="flex:1;padding:14px;border-radius:10px;background:transparent;border:1px solid rgba(255,255,255,0.06);color:#fff;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;font-weight:800;">${ICONS.pin} Ver ruta de Entrega</a>
          <button id="btn-pedido-entregado" class="btn-g" style="flex:1;background:linear-gradient(135deg,#FF6B35,#E55A27);color:#fff;border:none;border-radius:10px;padding:14px;font-weight:800;">¡Pedido Entregado!</button>
        </div>
      </div>
    `;
    // append alert button
    document.body.insertAdjacentHTML('beforeend', alertBtnHtml);
    document.getElementById('viaje-alert-btn')?.addEventListener('click', ()=>{
      if(confirm('¿Deseas reportar un problema con este viaje al administrador?')){ toast('Reporte enviado.'); }
    });
    document.getElementById('btn-pedido-entregado')?.addEventListener('click', ()=>{ completeDelivery(); });
    return;
  }

  if (activeTripState === 3) {
    // simple success state then auto-reset
  container.innerHTML = `<div class="empty"><div class="big">${ICONS.check}</div><p>Viaje finalizado con éxito.<br/>¡Gracias!</p></div>`;
    // simulate commission add and after 1.2s return to state 0
    const commission = Math.round((Number(v.costo_envio||800) * 0.75));
    // keep history by pushing to viajes as delivered
    // add to stats
    setTimeout(()=>{
      // update stats/earnings
      // Here we simulate that the trip was removed and stats updated
  activeTrip = null; activeTripState = 0; actualizarStats(); renderViajes(); toast(`${ICONS.confetti} Viaje finalizado · Ganaste $${commission.toLocaleString('es-AR')}`,3000);
    }, 1200);
    return;
  }
}

function moverFoco(el,nextId){el.value=el.value.toString().slice(-1);if(el.value&&nextId)document.getElementById(nextId)?.focus();}
function checkCod(vid,cod){const d1=document.getElementById(`cod-${vid}-1`)?.value||'';const d2=document.getElementById(`cod-${vid}-2`)?.value||'';const d3=document.getElementById(`cod-${vid}-3`)?.value||'';const d4=document.getElementById(`cod-${vid}-4`)?.value||'';const ing=d1+d2+d3+d4;const btn=document.getElementById(`btn-ver-${vid}`);const err=document.getElementById(`err-${vid}`);const ok=document.getElementById(`ok-${vid}`);if(ing.length===4){if(ing===cod){btn.disabled=false;err.style.display='none';ok.style.display='block';codsIngresados[vid]=ing;}else{btn.disabled=true;err.style.display='block';ok.style.display='none';}}else{btn.disabled=true;err.style.display='none';ok.style.display='none';}}

async function aceptarViaje(id){
  const v = viajes.find(x=>x.id===id);
  // optimistic UI
  if(v) v.estado = 'en_camino';
  renderViajes();
  try{
    const cadeteId = (await sb.auth.getUser()).data.user.id;
    if(window.cadeteAPI && typeof window.cadeteAPI.tomarPedidoSeguro === 'function'){
      const res = await window.cadeteAPI.tomarPedidoSeguro(id, cadeteId);
      // the RPC returns a truthy value on success; adjust based on your RPC contract
      if(res === null || res === undefined){
        // If RPC returned no data but did not throw, assume success
  toast(`${ICONS.check} Viaje aceptado · Andá a retirar`);
      } else if(res === false){
        // Someone else took it
  toast(`${ICONS.warn} No se pudo tomar el pedido: ya fue asignado.`);
        // reload list
        await cargarViajes();
      } else {
  toast(`${ICONS.check} Viaje aceptado · Andá a retirar`);
      }
    } else {
      // Fallback to direct update if API not available (shouldn't happen in prod)
      await sb.from('pedidos').update({estado:'en_camino'}).eq('id',id);
  toast(`${ICONS.check} Viaje aceptado · Andá a retirar`);
    }
  }catch(err){
    console.error('Error al tomar pedido seguro', err);
    toast('Error al aceptar el viaje. Intentá de nuevo.');
    // revert optimistic state
    const orig = viajes.find(x=>x.id===id);
    if(orig) orig.estado = 'preparando';
    renderViajes();
  }
}
function rechazarViaje(id){viajes=viajes.filter(v=>v.id!==id);renderViajes();toast(`${ICONS.warn} Viaje rechazado`);}
async function verificarEntrega(id,cod){
  const ing = codsIngresados[id];
  if(ing !== cod){ toast(`${ICONS.close} Código incorrecto`); return; }
  const earn = Math.round(800*0.75);
  try{
    if(window.cadeteAPI && typeof window.cadeteAPI.confirmarEntregaSegura === 'function'){
      const res = await window.cadeteAPI.confirmarEntregaSegura(id, ing);
      if(!res){
  toast(`${ICONS.close} PIN incorrecto o no se pudo confirmar la entrega.`);
        return;
      }
    } else {
      // fallback
      await sb.from('pedidos').update({estado:'entregado'}).eq('id',id);
    }
    // success
    const v = viajes.find(x=>x.id===id); if(v) v.estado='entregado';
    viajes = viajes.filter(x=>x.id!==id);
    renderViajes(); actualizarStats();
  toast(`${ICONS.confetti} Entrega confirmada · Ganaste $${earn.toLocaleString('es-AR')}`,3500);
  }catch(err){
    console.error('Error al confirmar entrega', err);
    toast('Error al confirmar la entrega. Intentá de nuevo.');
  }
}

// ===== State transition helpers for active trip UI =====
function removeAlertBtn(){const b=document.getElementById('viaje-alert-btn'); if(b) b.remove();}

async function markArrivedAtLocal(){
  if(!activeTrip) return;
  activeTripState = 2;
  renderViajes();
  try{
    const id = activeTrip.id;
    const cadeteId = (await sb.auth.getUser()).data.user.id;
    if(window.cadeteAPI && typeof window.cadeteAPI.tomarPedidoSeguro === 'function'){
      // use RPC to mark as en_camino (idempotent if already assigned)
      await window.cadeteAPI.tomarPedidoSeguro(id, cadeteId);
    } else {
      await sb.from('pedidos').update({estado:'en_camino'}).eq('id', id);
    }
  }catch(err){
    console.error('Error al marcar llegada al local', err);
    toast('Error actualizando estado. Intentá de nuevo.');
  }
  removeAlertBtn();
  toast(`${ICONS.check} Retiro confirmado · En camino al cliente`);
}

async function completeDelivery(){
  if(!activeTrip) return;
  activeTripState = 3;
  renderViajes();
  try{
    const id = activeTrip.id;
    if(window.cadeteAPI && typeof window.cadeteAPI.confirmarEntregaSegura === 'function'){
      // Without PIN flow, call confirmarEntregaSegura with null/empty to trigger server-side checks if designed so
      await window.cadeteAPI.confirmarEntregaSegura(id, null);
    } else {
      await sb.from('pedidos').update({estado:'entregado'}).eq('id', id);
    }
  }catch(err){
    console.error('Error marcando pedido como entregado', err);
    toast('Error actualizando estado. Intentá de nuevo.');
  }
  removeAlertBtn();
  renderViajes();
}

// Simulator for local testing
window.simularNuevoViaje = function(){
  const id = 'sim-' + Date.now();
  const fake = {
    id,
    numero: Math.floor(Math.random()*9000)+100,
    estado: 'preparando',
    tipo_delivery: 'app',
    items: [{nombre:'Pizza Muzarella',qty:1,precio:2500}],
    total: 5700,
    costo_envio: 800,
    direccion_entrega: 'Urquiza 456, Santiago del Estero',
    created_at: new Date().toISOString(),
    comercios: { nombre: 'La Piola Pizzería (Sim)', direccion: 'Av. Belgrano 234', telefono: '3700-123456' },
    cliente_nombre: 'Juan Pérez',
    cliente_telefono: '155-123-456',
    metodo_pago: 'Efectivo'
  };
  activeTrip = fake; activeTripState = 1; renderViajes(); toast(`${ICONS.scooter} Simulador: Nuevo viaje asignado`,2500);
};

function actualizarStats(){
  const hoy=viajes.filter(v=>{const d=new Date(v.created_at),n=new Date();return d.getDate()===n.getDate()&&d.getMonth()===n.getMonth();});
  document.getElementById('s-hoy').textContent=hoy.length;
  const earn=hoy.length*Math.round(800*0.75);
  document.getElementById('s-earn').textContent=earn>0?`$${earn.toLocaleString('es-AR')}`:'$0';
  document.getElementById('earn-sem').textContent=`$${(viajes.length*750).toLocaleString('es-AR')}`;
  document.getElementById('eg-viajes').textContent=viajes.length;
  document.getElementById('eg-prom').textContent='$700';
}

// ── ASISTENTE IA CADETE ──
let iaHistorialCadete=[];
let iaIniciadoCadete=false;

function iniciarAsistenteCadete(){
  if(iaIniciadoCadete)return;
  iaIniciadoCadete=true;
  agregarMsgIACadete('bot','¡Hola! Soy tu asistente de ruta 🤖\n\nPuedo ayudarte con:\n• Cómo funciona el sistema de pagos\n• Qué hacer si hay un problema en la entrega\n• Cómo mejorar tu rating\n• Dudas sobre la app\n\n¿En qué te ayudo?');
}

function agregarMsgIACadete(de,texto){
  const cont=document.getElementById('ia-msgs');
  if(!cont)return;
  const esBot=de==='bot';
  const textoHtml=texto.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');
  const div=document.createElement('div');
  div.style.cssText=`display:flex;justify-content:${esBot?'flex-start':'flex-end'};`;
  if(esBot){
    div.innerHTML=`<div style="max-width:85%;background:#1a1a1a;color:#fff;border-radius:4px 14px 14px 14px;padding:10px 14px;font-size:13px;line-height:1.6;">${textoHtml}</div>`;
  }else{
    div.innerHTML=`<div style="max-width:85%;background:#FF6B35;color:#fff;border-radius:14px 14px 4px 14px;padding:10px 14px;font-size:13px;line-height:1.5;">${textoHtml}</div>`;
  }
  cont.appendChild(div);
  cont.scrollTop=cont.scrollHeight;
}

function preguntaRapidaCadete(pregunta){
  const input=document.getElementById('ia-input');
  if(input){input.value=pregunta;enviarIACadete();}
}

async function enviarIACadete(){
  const input=document.getElementById('ia-input');
  const btn=document.getElementById('ia-btn');
  if(!input||!input.value.trim())return;
  const texto=input.value.trim();
  input.value='';
  btn.disabled=true;
  agregarMsgIACadete('usuario',texto);
  iaHistorialCadete.push({role:'user',content:texto});
  const cont=document.getElementById('ia-msgs');
  const typing=document.createElement('div');
  typing.id='ia-typing';
  typing.style.cssText='display:flex;justify-content:flex-start;';
  typing.innerHTML='<div style="background:#1a1a1a;border-radius:4px 14px 14px 14px;padding:10px 16px;"><div style="display:flex;gap:4px;height:16px;align-items:center;"><div style="width:6px;height:6px;border-radius:50%;background:#555;animation:bounce 1.2s infinite;"></div><div style="width:6px;height:6px;border-radius:50%;background:#555;animation:bounce 1.2s .2s infinite;"></div><div style="width:6px;height:6px;border-radius:50%;background:#555;animation:bounce 1.2s .4s infinite;"></div></div></div>';
  if(cont){cont.appendChild(typing);cont.scrollTop=cont.scrollHeight;}
  try{
  const res=await fetch('https://fmqlpgerqdiplnvjjarl.supabase.co/functions/v1/asistente',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(window.SUPABASE_ANON_KEY||'')},body:JSON.stringify({messages:iaHistorialCadete,rol:'cadete'})});
  const data=await res.json();
    const respuesta=data.respuesta||'No pude procesar tu consulta.';
    document.getElementById('ia-typing')?.remove();
    agregarMsgIACadete('bot',respuesta);
    iaHistorialCadete.push({role:'assistant',content:respuesta});
  }catch{
    document.getElementById('ia-typing')?.remove();
    agregarMsgIACadete('bot','Error de conexión. Intentá de nuevo.');
  }
  btn.disabled=false;
}

setInterval(cargarViajes,20000);

// Role guard: only allow users with role 'cadete'
;(async function guardCadete(){
  // Prevent this block from triggering multiple times while a redirect is already in progress
  if(window._cadete_redirecting) return;
  try{
    const { data: { session } } = await sb.auth.getSession();
    const user = session?.user || null;
    const role = user?.user_metadata?.role || user?.raw_user_meta_data?.role || null;
    if(!session || role !== 'cadete'){
      // Not authorized for cadete UI: sign out and replace location to avoid adding history entries
      window._cadete_redirecting = true;
      try{ await sb.auth.signOut(); }catch(e){}
      try{ alert('Acceso restringido a Cadetes'); }catch(e){}
      // Use replace so the browser doesn't keep the protected page in history
      window.location.replace('../cliente/login-usuario.html');
      return;
    }
    // authorized
    cargarViajes();
  }catch(e){
    console.warn('cadete guard check failed', e);
    if(!window._cadete_redirecting){
      window._cadete_redirecting = true;
      try{ await sb.auth.signOut(); }catch(e){}
      window.location.replace('../cliente/login-usuario.html');
    }
  }
})();

function conectarMPCadete(){const CLIENT_ID='3886989011728021';const REDIRECT_URI=encodeURIComponent('https://puertaapuerta.vercel.app/oauth-callback-cadete.html');const url=`https://auth.mercadopago.com.ar/authorization?client_id=${CLIENT_ID}&response_type=code&platform_id=mp&redirect_uri=${REDIRECT_URI}&state=cadete`;window.location.href=url;}

function iniciarRealtimeCadete(){
  try{sb.channel('viajes-nuevos').on('postgres_changes',{event:'UPDATE',schema:'public',table:'pedidos',filter:'tipo_delivery=eq.app'},(payload)=>{if(payload.new.estado==='preparando'){sonarViaje();toast(`${ICONS.scooter} ¡Nuevo viaje disponible!`,4000);cargarViajes();}}).subscribe();}catch{}
}

function sonarViaje(){try{const ctx=new(window.AudioContext||window.webkitAudioContext)();[784,659,784,880].forEach((freq,i)=>{const osc=ctx.createOscillator();const gain=ctx.createGain();osc.connect(gain);gain.connect(ctx.destination);osc.frequency.value=freq;osc.type='sine';gain.gain.setValueAtTime(0.3,ctx.currentTime+i*.12);gain.gain.exponentialRampToValueAtTime(0.01,ctx.currentTime+i*.12+.15);osc.start(ctx.currentTime+i*.12);osc.stop(ctx.currentTime+i*.12+.15);});}catch{}}

if('Notification' in window&&Notification.permission==='default'){Notification.requestPermission();}
iniciarRealtimeCadete();

// ── GUARDAR DATOS DEL CADETE ──
const checkForm = document.getElementById('cadete-form');
if (checkForm) {
  checkForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('cd-btn-save');
    const msg = document.getElementById('cd-msg');
    btn.textContent = 'Guardando...';
    btn.disabled = true;
    msg.textContent = '';
    msg.style.color = '#fff';

    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) throw new Error('No estás conectado.');

      const nombre = document.getElementById('cd-nombre').value.trim();
      const fecha_nacimiento = document.getElementById('cd-fecha').value || null;
      const email = document.getElementById('cd-email').value.trim();
      const vehiculo = document.getElementById('cd-vehiculo').value.trim();
      const color = document.getElementById('cd-color').value.trim();
      const patente = document.getElementById('cd-patente').value.trim();
      const antecedentes = document.getElementById('cd-antecedentes').value === 'true';

      let antecedentes_path = null;

      if (antecedentes) {
        const fileInput = document.getElementById('cd-pdf');
        const file = fileInput.files[0];
        if (!file) throw new Error('Debes adjuntar el PDF.');
        if (file.type !== 'application/pdf') throw new Error('El archivo debe ser un PDF.');
        if (file.size > 5 * 1024 * 1024) throw new Error('Máx 5MB permitido.');

        const filePath = `${user.id}/antecedentes/${Date.now()}_${file.name}`;
        const { error: upErr } = await sb.storage
          .from('cadetes-antecedentes')
          .upload(filePath, file, { cacheControl: '3600', upsert: false });
        
        if (upErr) throw new Error('Error subiendo PDF: ' + upErr.message);
        antecedentes_path = filePath;
      }

      // Upsert en tabla cadetes
      const { error: dbErr } = await sb.from('cadetes').upsert({
        auth_uid: user.id,
        nombre,
        fecha_nacimiento,
        email,
        vehiculo,
        color,
        patente,
        antecedentes,
        antecedentes_path
      }, { onConflict: 'auth_uid' });

      if (dbErr) throw new Error('Error guardando en BD: ' + dbErr.message);

      msg.textContent = '✅ Datos guardados correctamente.';
      msg.style.color = '#00C853';
      
      // Intentar cargar la info actual para confirmación visual 
      document.getElementById('perf-nombre').textContent = nombre;

    } catch(err) {
      msg.textContent = '❌ ' + err.message;
      msg.style.color = '#FF5252';
    } finally {
      btn.textContent = 'Guardar mis datos';
      btn.disabled = false;
    }
  });

  // Cargar datos previos si existen
  sb.auth.getUser().then(async ({ data: { user } }) => {
    if (user) {
      const { data } = await sb.from('cadetes').select('*').eq('auth_uid', user.id).single();
      if (data) {
        document.getElementById('cd-nombre').value = data.nombre || '';
        document.getElementById('cd-fecha').value = data.fecha_nacimiento || '';
        document.getElementById('cd-email').value = data.email || '';
        document.getElementById('cd-vehiculo').value = data.vehiculo || '';
        document.getElementById('cd-color').value = data.color || '';
        document.getElementById('cd-patente').value = data.patente || '';
        if (data.antecedentes) {
          document.getElementById('cd-antecedentes').value = 'true';
          document.getElementById('cd-ant-upload').style.display = 'block';
        }
      }
    }
  });
}
