// ICONS se expone como global por main.js (módulo). Se actualiza en el evento 'load'.
var ICONS = {};
let currentScreen='home',currentComercio=null,payMethod='mercadopago',currentPedido=window.state ? window.state.currentPedido : null,trackInterval=null,allComercios=[];
let propinaSeleccionada=0;

// ═══════════════════════════════════════════════════════════════════════════════
// LEAFLET — mapa de tracking en tiempo real del cadete
// ═══════════════════════════════════════════════════════════════════════════════
let _trkMap=null,_trkCadeteMarker=null,_trkClienteMarker=null;

function initTrackingMap(cLat,cLng){
  const el=document.getElementById('map-tracking');
  if(!el||!window.L) return;

  // Destruir mapa anterior si existe (ej: vuelve a abrir tracking)
  if(_trkMap){try{_trkMap.remove();}catch{}_trkMap=null;_trkCadeteMarker=null;_trkClienteMarker=null;}

  const center=(cLat&&cLng)?[cLat,cLng]:[-27.7951,-64.2615];

  _trkMap=L.map(el,{center,zoom:15,zoomControl:false,attributionControl:false});
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(_trkMap);

  if(cLat&&cLng){
    _trkClienteMarker=L.marker(center,{
      icon:L.divIcon({className:'',html:'<div style="width:14px;height:14px;border-radius:50%;background:#3B82F6;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35)"></div>',iconSize:[20,20],iconAnchor:[10,10]})
    }).addTo(_trkMap).bindTooltip('Vos',{permanent:true,direction:'bottom',offset:[0,10],className:'leaflet-tooltip-custom'});
  }
}

function moverCadeteEnMapa(lat,lng){
  if(!_trkMap||!window.L) return;
  const pos=[Number(lat),Number(lng)];

  if(!_trkCadeteMarker){
    _trkCadeteMarker=L.marker(pos,{
      icon:L.divIcon({className:'',html:'<div style="font-size:28px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.3))"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#FF6B35" stroke-width="2"><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7.5 18h9M5 16l1-5h4l3 5M14 11l1.5-4H19l1 4"/></svg></div>',iconSize:[32,32],iconAnchor:[16,16]})
    }).addTo(_trkMap).bindTooltip('Tu cadete',{permanent:true,direction:'top',offset:[0,-14],className:'leaflet-tooltip-custom'});
  }else{
    _trkCadeteMarker.setLatLng(pos);
  }

  // Ajustar vista para que se vean ambos marcadores con 20% de margen
  if(_trkClienteMarker){
    _trkMap.fitBounds(L.latLngBounds([_trkClienteMarker.getLatLng(),pos]).pad(0.2),{maxZoom:16,animate:true,duration:1});
  }else{
    _trkMap.setView(pos,15,{animate:true,duration:1});
  }
}

function go(screen){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('s-'+screen).classList.add('active');
  document.querySelectorAll('.nav-i').forEach(n=>n.classList.remove('active'));
  const navMap={home:'nav-home',pedidos:'nav-pedidos','pedido-detalle':'nav-pedidos',carrito:'nav-carrito',perfil:'nav-perfil',soporte:'nav-soporte','chat-reporte':'nav-soporte',asistente:'nav-soporte'};
  if(navMap[screen])document.getElementById(navMap[screen]).classList.add('active');
  currentScreen=screen;
  if(screen==='carrito'){renderCarrito();cargarDireccionesEnCarrito();actualizarDirGPS();}
  if(screen==='pedidos')cargarPedidos();
  window.scrollTo(0,0);
}

function showToast(msg,duration=2500){document.getElementById('toast-msg').innerHTML=msg;const t=document.getElementById('toast');t.style.display='block';setTimeout(()=>t.style.display='none',duration);}

async function cargarComercios(){
  // Cache: mostrar datos guardados inmediatamente mientras se recarga
  const cached = localStorage.getItem('pap_comercios_cache');
  if (cached) {
    try { allComercios = JSON.parse(cached); renderRubros(); } catch {}
  }
  try{
    const{data,error}=await sb.from('comercios').select('*').order('nombre',{ascending:true});
    if(error)throw error;
    allComercios=data||[];
    try { localStorage.setItem('pap_comercios_cache', JSON.stringify(allComercios)); } catch {}
  }catch(e){
    console.error('[PaP] Error cargando comercios:', e);
    if (!allComercios.length) allComercios=[];
  }
  renderRubros();
}

const RUBROS=[{"id":"comida","label":"Restaurantes","img":"https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=400&q=75","svg":"<svg width=\"18\" height=\"18\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" viewBox=\"0 0 24 24\"><path d=\"M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z\"></path></svg>"},{"id":"supermercado","label":"Supermercado","img":"https://images.unsplash.com/photo-1604719312566-8912e9227c6a?w=400&q=75","svg":"<svg width=\"18\" height=\"18\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" viewBox=\"0 0 24 24\"><path d=\"M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z\"></path></svg>"},{"id":"verduleria","label":"Verdulería","img":"https://images.unsplash.com/photo-1518843875459-f738682238a6?w=400&q=75","svg":"<svg width=\"18\" height=\"18\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" viewBox=\"0 0 24 24\"><path d=\"M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z\"></path></svg>"},{"id":"heladeria","label":"Heladería","img":"https://images.unsplash.com/photo-1497034825429-c343d7c6a68f?w=400&q=75","svg":"<svg width=\"18\" height=\"18\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" viewBox=\"0 0 24 24\"><path d=\"M12 2v20m-7-7a7 7 0 1114 0H5z\"></path></svg>"},{"id":"mascotas","label":"Mascotas","img":"https://images.unsplash.com/photo-1601758228041-f3b2795255f1?w=400&q=75","svg":"<svg width=\"18\" height=\"18\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" viewBox=\"0 0 24 24\"><path d=\"M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1v12zm11-5.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z\"></path></svg>"},{"id":"bebidas","label":"Bebidas","img":"https://images.unsplash.com/photo-1437418747212-8d9709afab22?w=400&q=75","svg":"<svg width=\"18\" height=\"18\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" viewBox=\"0 0 24 24\"><path d=\"M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4a2 2 0 012 2v14a2 2 0 01-2 2zm10 0h-4a2 2 0 01-2-2v-5a2 2 0 012-2h4a2 2 0 012 2v5a2 2 0 01-2 2z\"></path></svg>"},{"id":"carniceria","label":"Carnicería","img":"https://images.unsplash.com/photo-1529692236671-f1f6cf9683ba?w=400&q=75","svg":"<svg width=\"18\" height=\"18\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" viewBox=\"0 0 24 24\"><path d=\"M4 4h16v16H4zM4 9h16M9 4v16\"></path></svg>"},{"id":"farmacia","label":"Farmacia","img":"https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=400&q=75","svg":"<svg width=\"18\" height=\"18\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" viewBox=\"0 0 24 24\"><path d=\"M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10\"></path></svg>"},{"id":"panaderia","label":"Panadería","img":"https://images.unsplash.com/photo-1509440159596-0249088772ff?w=400&q=75","svg":"<svg width=\"18\" height=\"18\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" viewBox=\"0 0 24 24\"><path d=\"M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z\"></path></svg>"},{"id":"kiosco","label":"Kiosco","img":"https://images.pexels.com/photos/8867645/pexels-photo-8867645.jpeg?w=400&q=75","svg":"<svg width=\"18\" height=\"18\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" viewBox=\"0 0 24 24\"><path d=\"M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z\"></path><path d=\"M9 22V12h6v10\"></path></svg>"}];

let _rubrosActivos = null;
async function cargarRubrosActivos() {
  if (_rubrosActivos) return _rubrosActivos;
  // Cache: usar rubros guardados mientras se recarga
  const cached = localStorage.getItem('pap_rubros_cache');
  if (cached) { try { _rubrosActivos = new Set(JSON.parse(cached)); } catch {} }
  try {
    const { data } = await sb.from('rubros_config').select('id').eq('activo', true);
    const ids = (data||[]).map(r => r.id);
    _rubrosActivos = new Set(ids);
    try { localStorage.setItem('pap_rubros_cache', JSON.stringify(ids)); } catch {}
  } catch {
    if (!_rubrosActivos) _rubrosActivos = new Set(RUBROS.map(r => r.id));
  }
  return _rubrosActivos;
}

async function renderRubros(){
  const activos = await cargarRubrosActivos();
  let categoriasConPromo=new Set();
  try{const hoy=new Date().toISOString().split('T')[0];const ids=allComercios.map(c=>c.id);if(ids.length){const{data}=await sb.from('promociones').select('comercio_id').eq('activa',true).gte('fecha_fin',hoy).in('comercio_id',ids);const comerciosConPromo=new Set((data||[]).map(p=>p.comercio_id));allComercios.forEach(c=>{if(comerciosConPromo.has(c.id))categoriasConPromo.add(c.categoria);});}}catch{}
  const _star=(window.ICONS&&window.ICONS.star)||'*';
  const _fire=(window.ICONS&&window.ICONS.fire)||'';
  // Sección 1: comercios de rubros activos solamente
  const comerciosFiltrados = allComercios.filter(c => activos.has(c.categoria));
  const tiendas=comerciosFiltrados.map(c=>{const tienePromo=categoriasConPromo.has(c.categoria);return`<div class="com-card" style="margin:0 18px 14px;" onclick="abrirComercio('${c.id}')"><div class="com-img"><img src="${c.imagen_url||''}" alt="${c.nombre}" loading="lazy"/><div class="com-img-overlay"></div><div class="com-img-badge">${c.abierto_ahora?'<span class="tag tag-g">Abierto</span>':'<span class="closed-badge">Cerrado</span>'}</div></div><div class="com-info"><div class="com-name">${c.nombre}</div><div class="com-meta"><span>${_star} ${c.rating||'4.5'}</span><span style="text-transform:capitalize">${c.categoria||''}</span>${tienePromo?`<span style="color:#FF6B35;font-weight:700;">${_fire} Ofertas</span>`:''}</div></div></div>`;}).join('');
  // Sección 2: solo rubros activos
  const rubrosActivos = RUBROS.filter(r => activos.has(r.id));
  const rubros=rubrosActivos.map(r=>{const tienePromo=categoriasConPromo.has(r.id);const promoBadge=tienePromo?`<div style="position:absolute;top:10px;left:10px;z-index:3;background:#FF6B35;color:#fff;font-size:10px;font-weight:800;padding:4px 10px;border-radius:20px;">${_fire} Ofertas</div>`:'';return`<div class="com-card" onclick="abrirRubro('${r.id}','${r.label}')"><div class="com-img"><img src="${r.img}" alt="${r.label}" loading="lazy"/><div class="com-img-overlay"></div>${promoBadge}</div><div class="com-info"><div class="com-name"><span style="display:inline-flex;align-items:center;gap:6px;">${r.svg} ${r.label}</span></div><div class="com-meta"><span>Toca para ver todos</span>${tienePromo?`<span style="color:#FF6B35;font-weight:700;">${_fire} Con ofertas</span>`:''}</div></div></div>`;}).join('');
  document.getElementById('comercios-container').innerHTML=(tiendas?`<div class="sec-head"><h3>Comercios cerca de vos</h3></div>${tiendas}`:'')+'<div class="sec-head" style="margin-top:8px;"><h3>Explorar por categoría</h3></div>'+rubros;
}

async function abrirRubro(catId,label){
  const lista=allComercios.filter(c=>c.categoria===catId);
  const tiempos={comida:'20–30',carniceria:'15–25',farmacia:'10–20',supermercado:'25–35',verduleria:'20–30',panaderia:'10–20',heladeria:'15–25',bebidas:'10–20',mascotas:'20–30'};
  const envios={comida:'desde $1.200',carniceria:'desde $1.200',farmacia:'desde $1.200',supermercado:'desde $1.200',verduleria:'desde $1.200',panaderia:'desde $1.200',heladeria:'desde $1.200',bebidas:'desde $1.200',mascotas:'desde $1.200',kiosco:'desde $1.200'};
  document.getElementById('det-name').textContent=label;
  document.getElementById('det-meta').textContent=lista.length?`${lista.length} comercio${lista.length>1?'s':''} disponible${lista.length>1?'s':''}`:'Próximamente en tu zona';
  document.getElementById('cart-float').style.display='none';
  let promosActivas={};
  try{const ids=lista.map(c=>c.id);const hoy=new Date().toISOString().split('T')[0];const{data}=await sb.from('promociones').select('comercio_id,tipo,porcentaje').eq('activa',true).gte('fecha_fin',hoy).in('comercio_id',ids);(data||[]).forEach(p=>{promosActivas[p.comercio_id]=p;});}catch{}
  if(!lista.length){document.getElementById('menu-container').innerHTML='<div class="empty"><div class="big"></div><p>Todavía no hay comercios<br>de este rubro en tu zona.<br>¡Pronto habrá más!</p></div>';}
  else{document.getElementById('menu-container').innerHTML=lista.map(c=>{const promo=promosActivas[c.id];const promoBadge=promo?`<div style="position:absolute;top:10px;left:10px;z-index:3;background:#FF6B35;color:#fff;font-size:10px;font-weight:800;padding:4px 10px;border-radius:20px;letter-spacing:.03em;">${ICONS.fire} ${promo.tipo==='envio_gratis'?'Envío gratis':`${promo.porcentaje}% OFF`}</div>`:'';const promoInfo=promo?`<span style="color:#FF6B35;font-weight:700;">${ICONS.fire} ${promo.tipo==='envio_gratis'?'Envío gratis hoy':`${promo.porcentaje}% de descuento`}</span>`:'';return`<div class="com-card" style="margin:14px 18px;" onclick="abrirComercio('${c.id}')"><div class="com-img"><img src="${c.imagen_url||''}" alt="${c.nombre}" loading="lazy"/><div class="com-img-overlay"></div>${promoBadge}<div class="com-img-badge">${c.abierto_ahora?'<span class="tag tag-g">Abierto</span>':'<span class="closed-badge">Cerrado</span>'}</div></div><div class="com-info"><div class="com-name">${c.nombre}</div><div class="com-meta"><span>${ICONS.star} ${c.rating}</span><span>${ICONS.clock} ${tiempos[c.categoria]||'20–30'} min</span><span>${ICONS.scooter} ${envios[c.categoria]||'$800'} envío</span>${promoInfo?`<span>${promoInfo}</span>`:''}</div></div></div>`;}).join('');}

  go('detail');
}

function filtrar(el,cat){document.querySelectorAll('.cat').forEach(c=>c.classList.remove('active'));el.classList.add('active');if(cat==='todos'){renderRubros();return;}abrirRubro(cat,RUBROS.find(r=>r.id===cat)?.label||cat);}

let searchTimeout=null;
function buscarTiempoReal(q){const clearBtn=document.getElementById('search-clear');if(clearBtn)clearBtn.style.display=q?'block':'none';clearTimeout(searchTimeout);if(!q.trim()){cerrarResultados();renderRubros();return;}searchTimeout=setTimeout(()=>{const resultados=allComercios.filter(c=>c.nombre.toLowerCase().includes(q.toLowerCase())||c.categoria.toLowerCase().includes(q.toLowerCase()));mostrarResultados(resultados,q);},200);}
function mostrarResultados(lista,q){
  const cont=document.getElementById('search-results');
  if(!cont)return;
  if(!lista.length){
    cont.style.display='block';
    cont.innerHTML=`<div style="padding:20px;text-align:center;color:var(--gray-400);font-size:13px;">Sin resultados para "<b>${q}</b>"</div>`;
    return;
  }
  const starIcon=(window.ICONS&&window.ICONS.star)||'*';
  cont.style.display='block';
  cont.innerHTML=lista.map(c=>`<div onclick="selResultado('${c.id}')" style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid #F0F0F0;cursor:pointer;background:#fff;" onmouseover="this.style.background='#FFF8F6'" onmouseout="this.style.background='#fff'"><div style="width:44px;height:44px;border-radius:10px;overflow:hidden;flex-shrink:0;background:#f5f5f5;"><img src="${c.imagen_url||''}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'"/></div><div style="flex:1;"><div style="font-size:14px;font-weight:700;color:#0D0D0D;">${c.nombre}</div><div style="font-size:11px;color:#9DA3AE;margin-top:2px;">${starIcon} ${c.rating||''} · ${c.categoria||''}</div></div><span style="font-size:11px;font-weight:700;padding:3px 8px;border-radius:20px;background:${c.abierto_ahora?'#DCFCE7':'#F3F4F6'};color:${c.abierto_ahora?'#16A34A':'#9DA3AE'};">${c.abierto_ahora?'Abierto':'Cerrado'}</span></div>`).join('');
}
function selResultado(id){cerrarResultados();limpiarBusqueda();abrirComercio(id);}
function cerrarResultados(){const cont=document.getElementById('search-results');if(cont)cont.style.display='none';}
function limpiarBusqueda(){const input=document.getElementById('search-input');const clearBtn=document.getElementById('search-clear');if(input)input.value='';if(clearBtn)clearBtn.style.display='none';cerrarResultados();renderRubros();}
document.addEventListener('click',(e)=>{if(!e.target.closest('.search-box')&&!e.target.closest('#search-results'))cerrarResultados();});

let _mapaListo=false,_mapaObj=null,_pinObj=null;
function cargarMapaCarrito(lat,lng){const wrap=document.getElementById('mapa-wrap');const div=document.getElementById('mapa-carrito');if(!wrap||!div)return;wrap.style.display='block';if(!window.google||!window.google.maps){const s=document.createElement('script');s.src='https://maps.googleapis.com/maps/api/js?key=AIzaSyASBhagsg9KOoRLRaXmI8BEw9VMvf3dQo0&language=es';s.async=true;s.onload=()=>crearMapa(lat,lng);s.onerror=()=>{wrap.style.display='none';};document.head.appendChild(s);}else{crearMapa(lat,lng);}}
function crearMapa(lat,lng){try{const div=document.getElementById('mapa-carrito');if(!div||_mapaListo){if(_mapaObj&&_pinObj){const pos={lat,lng};_mapaObj.setCenter(pos);_pinObj.setPosition(pos);}return;}_mapaListo=true;_mapaObj=new google.maps.Map(div,{center:{lat,lng},zoom:17,disableDefaultUI:true,zoomControl:true});_pinObj=new google.maps.Marker({position:{lat,lng},map:_mapaObj,draggable:true,icon:{url:'https://maps.google.com/mapfiles/ms/icons/orange-dot.png',scaledSize:new google.maps.Size(36,36),anchor:new google.maps.Point(18,36)}});_pinObj.addListener('dragend',async()=>{const p=_pinObj.getPosition();const dir=await obtenerDireccionDesdePin(p.lat(),p.lng());const gpsTxt=document.getElementById('dir-gps-txt');if(gpsTxt)gpsTxt.textContent=dir;ubicacionActual=dir;selDireccion('gps');let numInput=document.getElementById('num-casa-wrap');if(!numInput){numInput=document.createElement('div');numInput.id='num-casa-wrap';numInput.style.cssText='margin-top:8px;display:flex;gap:8px;align-items:center;';numInput.innerHTML=`<input id="num-casa" placeholder="Número de puerta (ej: 450)" style="flex:1;border:1.5px solid #FF6B35;border-radius:10px;padding:10px 14px;font-size:13px;outline:none;font-family:inherit;" oninput="actualizarNumCasa()"/>`;document.getElementById('dir-opt-gps').after(numInput);}numInput.style.display='flex';});}catch(e){document.getElementById('mapa-wrap').style.display='none';}}
function actualizarNumCasa(){const num=document.getElementById('num-casa')?.value.trim();const base=ubicacionActual||'';if(num){const dirConNum=base.replace(/\s+\d+,/,',').replace(/^([^,]+)/,`$1 ${num}`);document.getElementById('dir-gps-txt').textContent=dirConNum;ubicacionActual=dirConNum;}}

async function cargarRatingsComercio(comercioId){const sec=document.getElementById('ratings-comercio');if(!sec)return;try{const{data}=await sb.from('ratings').select('*').eq('comercio_id',comercioId).order('created_at',{ascending:false}).limit(10);if(!data||!data.length){sec.style.display='none';return;}sec.style.display='block';const total=data.length;const promedio=(data.reduce((s,r)=>s+r.rating,0)/total).toFixed(1);const barras=[5,4,3,2,1].map(n=>{const cant=data.filter(r=>r.rating===n).length;const pct=total?Math.round(cant/total*100):0;return`<div class="rating-bar-row"><div class="rating-bar-label">${n}</div><div class="rating-bar-bg"><div class="rating-bar-fill" style="width:${pct}%"></div></div><div style="font-size:10px;color:#9DA3AE;width:24px;">${pct}%</div></div>`;}).join('');const estrellas=n=>{const full='<svg width="14" height="14" viewBox="0 0 24 24" fill="#f59e0b" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';const empty='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="1.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';return full.repeat(n)+empty.repeat(5-n);};sec.innerHTML=`<div style="font-size:14px;font-weight:800;color:#0D0D0D;margin-bottom:12px;">Opiniones de clientes</div><div class="rating-resumen"><div><div class="rating-num-grande">${promedio}</div><div style="font-size:18px;margin:4px 0;">${estrellas(Math.round(promedio))}</div><div style="font-size:11px;color:#9DA3AE;">${total} opinión${total>1?'es':''}</div></div><div class="rating-bars">${barras}</div></div>${data.filter(r=>r.comentario).slice(0,3).map(r=>`<div class="comentario-card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;"><div style="font-size:13px;font-weight:700;">Usuario</div><div style="font-size:14px;">${estrellas(r.rating)}</div></div><div style="font-size:12px;color:#5C6270;">${r.comentario}</div></div>`).join('')}`;}catch{sec.style.display='none';}}

function abrirDevolucion(){document.getElementById('devolucion-screen').classList.add('visible');}
function cerrarDevolucion(){document.getElementById('devolucion-screen').classList.remove('visible');}

async function reportarProblema(tipo){
  cerrarDevolucion();
  const tipoLabel={'no-llegó':'No llegó lo que pedí','mal-estado':'Llegó en mal estado','faltó-algo':'Faltó algo en el pedido','no-llegó-pedido':'No recibí el pedido'}[tipo]||tipo;
  let reporteId=null;const limite=new Date(Date.now()+10*60*1000).toISOString();
  try{const{data}=await sb.from('reportes').insert([{pedido_id:currentPedido?.id,comercio_id:currentComercio?.id,tipo,estado:'pendiente',limite_resolucion:limite}]).select().single();reporteId=data?.id;await sb.from('chat_reportes').insert([{reporte_id:reporteId,pedido_id:currentPedido?.id,comercio_id:currentComercio?.id,de:'sistema',texto:`Reporte: "${tipoLabel}". El comercio tiene 10 minutos para resolver.`}]);await sb.from('advertencias_comercio').insert([{comercio_id:currentComercio?.id,motivo:tipo,pedido_id:currentPedido?.id}]);}catch(e){}
  abrirChatReporte(reporteId,tipoLabel,limite);
}

let historialAsistente=[];
function abrirAsistente(){go('asistente');const msgs=document.getElementById('asistente-msgs');if(msgs&&!msgs.children.length)agregarMsgAsistente('bot','¡Hola! Soy el asistente de **Puerta a Puerta X**\n\nPuedo ayudarte con:\n• Cómo hacer un pedido\n• Problemas con una entrega\n• Cómo reportar un comercio\n• Métodos de pago\n• Cualquier otra duda\n\n¿En qué te puedo ayudar?');}
function agregarMsgAsistente(de,texto){const cont=document.getElementById('asistente-msgs');if(!cont)return;const esBot=de==='bot';const div=document.createElement('div');div.style.cssText=`display:flex;justify-content:${esBot?'flex-start':'flex-end'};`;const textoHtml=texto.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');if(esBot){div.innerHTML=`<div style="display:flex;gap:8px;align-items:flex-start;max-width:85%;"><div style="width:30px;height:30px;border-radius:50%;background:#FF6B35;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;margin-top:2px;color:#fff;font-weight:700;">IA</div><div style="background:#fff;color:#0D0D0D;border-radius:4px 16px 16px 16px;padding:12px 14px;font-size:13px;line-height:1.6;box-shadow:0 1px 4px rgba(0,0,0,.08);">${textoHtml}</div></div>`;}else{div.innerHTML=`<div style="max-width:85%;background:#FF6B35;color:#fff;border-radius:16px 16px 4px 16px;padding:12px 14px;font-size:13px;line-height:1.5;">${textoHtml}</div>`;}cont.appendChild(div);cont.scrollTop=cont.scrollHeight;}
function agregarTyping(){const cont=document.getElementById('asistente-msgs');if(!cont)return;const div=document.createElement('div');div.id='typing-indicator';div.style.cssText='display:flex;justify-content:flex-start;';div.innerHTML=`<div style="display:flex;gap:8px;align-items:flex-start;"><div style="width:30px;height:30px;border-radius:50%;background:#FF6B35;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;color:#fff;font-weight:700;">IA</div><div style="background:#fff;border-radius:4px 16px 16px 16px;padding:12px 16px;box-shadow:0 1px 4px rgba(0,0,0,.08);"><div style="display:flex;gap:4px;align-items:center;height:18px;"><div style="width:7px;height:7px;border-radius:50%;background:#9DA3AE;animation:bounce 1.2s infinite;"></div><div style="width:7px;height:7px;border-radius:50%;background:#9DA3AE;animation:bounce 1.2s .2s infinite;"></div><div style="width:7px;height:7px;border-radius:50%;background:#9DA3AE;animation:bounce 1.2s .4s infinite;"></div></div></div></div>`;cont.appendChild(div);cont.scrollTop=cont.scrollHeight;}
async function enviarAsistente(){const input=document.getElementById('asistente-input');const btn=document.getElementById('asistente-btn');if(!input||!input.value.trim())return;const texto=input.value.trim();input.value='';btn.disabled=true;agregarMsgAsistente('usuario',texto);historialAsistente.push({role:'user',content:texto});agregarTyping();try{const res=await fetch('https://fmqlpgerqdiplnvjjarl.supabase.co/functions/v1/asistente',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(window.SUPABASE_ANON_KEY||'')},body:JSON.stringify({messages:historialAsistente,rol:'usuario'})});const data=await res.json();const respuesta=data.respuesta||'Lo siento, no pude procesar tu consulta.';document.getElementById('typing-indicator')?.remove();agregarMsgAsistente('bot',respuesta);historialAsistente.push({role:'assistant',content:respuesta});}catch{document.getElementById('typing-indicator')?.remove();agregarMsgAsistente('bot','Hubo un error de conexión. Intentá de nuevo en unos segundos.');}btn.disabled=false;input.focus();}
const styleAsistente=document.createElement('style');styleAsistente.textContent=`@keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}`;document.head.appendChild(styleAsistente);

async function cargarChatsReporte(){const cont=document.getElementById('soporte-list');if(!cont)return;try{const{data}=await sb.from('reportes').select('*').order('created_at',{ascending:false}).limit(10);const rep=data||[];const badge=document.getElementById('nav-soporte-badge');if(badge)badge.style.display=rep.filter(r=>r.estado==='pendiente').length?'block':'none';if(!rep.length){cont.innerHTML=`<div style="display:flex;flex-direction:column;align-items:center;padding:48px 24px;text-align:center;"><div style="font-size:48px;margin-bottom:16px;">${ICONS.check||''}</div><div style="font-size:17px;font-weight:800;color:var(--black);margin-bottom:8px;">Sin reportes activos</div><div style="font-size:13px;color:var(--gray-400);line-height:1.6;">Cuando tengas un problema con un pedido, aparecerá acá.</div></div>`;return;}const tipoLabel={'no-llegó':'No llegó lo que pedí','mal-estado':'Llegó en mal estado','faltó-algo':'Faltó algo en el pedido','no-llegó-pedido':'No recibí el pedido'};const estadoColor={'pendiente':'#FF6B35','resuelto':'#16A34A','vencido':'#DC2626'};const estadoLabel={'pendiente':'Pendiente','resuelto':'Resuelto','vencido':'Vencido'};cont.innerHTML=rep.map(r=>{const limite=r.limite_resolucion?new Date(r.limite_resolucion):null;const vencido=limite&&new Date()>limite&&r.estado==='pendiente';const estado=vencido?'vencido':r.estado;const fecha=new Date(r.created_at).toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'});const hora=new Date(r.created_at).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'});return`<div onclick="reabrirChat('${r.id}','${r.tipo}','${r.limite_resolucion||''}')" style="background:#fff;border-radius:14px;padding:14px;margin-bottom:10px;border:1px solid ${r.estado==='pendiente'?'#FECACA':'#E0E0E0'};cursor:pointer;display:flex;align-items:center;gap:12px;"><div style="width:44px;height:44px;border-radius:50%;background:${r.estado==='pendiente'?'#FEE2E2':'#F0F0F0'};display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">${r.estado==='pendiente'?(ICONS.warn||'!'):(ICONS.check||'')}</div><div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:700;color:var(--black);">${tipoLabel[r.tipo]||r.tipo}</div><div style="font-size:11px;color:var(--gray-400);margin-top:3px;">${fecha} a las ${hora}</div></div><div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;"><span style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:20px;background:${estadoColor[estado]}20;color:${estadoColor[estado]};">${estadoLabel[estado]||estado}</span></div></div>`;}).join('');}catch{cont.innerHTML='<div style="text-align:center;padding:30px;color:var(--gray-400);">No hay reportes.</div>';}}

let chatReporteId=null,chatReporteInterval=null,chatReporteChannel=null;
async function abrirChatReporte(reporteId,tipoLabel,limiteStr){chatReporteId=reporteId;document.getElementById('chat-reporte-subtitulo').textContent=tipoLabel;go('chat-reporte');await cargarMsgsChatReporte();if(chatReporteInterval)clearInterval(chatReporteInterval);let lastCount=0;chatReporteInterval=setInterval(async()=>{try{const{data}=await sb.from('chat_reportes').select('*').eq('reporte_id',reporteId).order('created_at',{ascending:true});if(data&&data.length>lastCount){lastCount=data.length;const cont=document.getElementById('chat-reporte-msgs');if(!cont)return;cont.innerHTML='';data.forEach(m=>{if(m.de==='sistema')agregarMsgSistema(m.texto);else agregarBurbuja(m.de,m.texto,m.created_at);});}}catch{}},3000);if(limiteStr){const limite=new Date(limiteStr);const countInterval=setInterval(()=>{const restante=Math.max(0,limite-new Date());const min=Math.floor(restante/60000).toString().padStart(2,'0');const seg=Math.floor((restante%60000)/1000).toString().padStart(2,'0');const el=document.getElementById('chat-reporte-countdown');if(el){el.textContent=`${min}:${seg}`;el.style.color=restante<120000?'#DC2626':'#FF6B35';}if(restante<=0){clearInterval(countInterval);agregarMsgSistema('Tiempo vencido. Tu pedido fue anulado y recibís el reembolso.');}},1000);}if(chatReporteChannel)sb.removeChannel(chatReporteChannel);chatReporteChannel=sb.channel('chat-r-'+Date.now()).on('postgres_changes',{event:'INSERT',schema:'public',table:'chat_reportes'},(payload)=>{const m=payload.new;if(m.de==='comercio')agregarBurbuja('comercio',m.texto,m.created_at);}).subscribe();}
async function cargarMsgsChatReporte(){const cont=document.getElementById('chat-reporte-msgs');if(!cont)return;try{const{data}=await sb.from('chat_reportes').select('*').eq('reporte_id',chatReporteId).order('created_at',{ascending:true});cont.innerHTML='';if(!data||!data.length){cont.innerHTML='<div style="text-align:center;color:#9DA3AE;font-size:13px;padding:20px;">Esperá la respuesta del comercio...</div>';return;}data.forEach(m=>{if(m.de==='sistema')agregarMsgSistema(m.texto);else agregarBurbuja(m.de,m.texto,m.created_at);});}catch{}}
function agregarBurbuja(de,texto,created_at){const cont=document.getElementById('chat-reporte-msgs');if(!cont)return;const hora=created_at?new Date(created_at).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}):new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'});const esUsuario=de==='usuario';const div=document.createElement('div');div.style.cssText=`display:flex;justify-content:${esUsuario?'flex-end':'flex-start'};margin:4px 0;`;if(esUsuario){div.innerHTML=`<div style="max-width:75%;background:#FF6B35;color:#fff;border-radius:16px 16px 4px 16px;padding:10px 14px;font-size:13px;line-height:1.4;">${texto}<div style="font-size:10px;opacity:.7;margin-top:4px;text-align:right;">${hora}</div></div>`;}else{div.innerHTML=`<div style="max-width:75%;background:#fff;color:#0D0D0D;border-radius:16px 16px 16px 4px;padding:10px 14px;font-size:13px;line-height:1.4;box-shadow:0 1px 4px rgba(0,0,0,.08);"><div style="font-size:10px;color:#FF6B35;font-weight:700;margin-bottom:4px;">${currentComercio?.nombre||'Comercio'}</div>${texto}<div style="font-size:10px;color:#9DA3AE;margin-top:4px;">${hora}</div></div>`;}cont.appendChild(div);cont.scrollTop=cont.scrollHeight;}
function agregarMsgSistema(texto){const cont=document.getElementById('chat-reporte-msgs');if(!cont)return;const div=document.createElement('div');div.style.cssText='text-align:center;margin:8px 0;';div.innerHTML=`<span style="background:#E0E0E0;color:#5C6270;font-size:11px;padding:4px 12px;border-radius:20px;">${texto}</span>`;cont.appendChild(div);cont.scrollTop=cont.scrollHeight;}
async function enviarMsgReporte(){const input=document.getElementById('chat-reporte-input');if(!input||!input.value.trim())return;const texto=input.value.trim();input.value='';agregarBurbuja('usuario',texto,null);try{await sb.from('chat_reportes').insert([{reporte_id:chatReporteId,pedido_id:currentPedido?.id,comercio_id:currentComercio?.id,de:'usuario',texto}]);}catch{}}
function mostrarBotonDevolucion(){const wrap=document.getElementById('btn-devolucion-wrap');if(wrap)wrap.style.display='block';}

let dirTimer=null;
async function buscarDireccion(q){const sugs=document.getElementById('sugerencias-dir');if(!sugs)return;if(!q||q.length<3){sugs.style.display='none';return;}clearTimeout(dirTimer);dirTimer=setTimeout(async()=>{try{const res=await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&countrycodes=ar&format=json&limit=5&accept-language=es&addressdetails=1`);const data=await res.json();if(data.length){sugs.style.display='block';sugs.innerHTML=data.map(r=>{const a=r.address||{};const calle=a.road||a.pedestrian||a.path||'';const numero=a.house_number||'';const ciudad=a.city||a.town||a.village||a.municipality||'';const provincia=a.state||'';let linea1=calle?(numero?`${calle} ${numero}`:calle):r.display_name.split(',')[0];let linea2=[ciudad,provincia].filter(Boolean).join(', ');const dirCompleta=linea2?`${linea1}, ${linea2}`:linea1;return`<div onclick="elegirDireccion('${dirCompleta.replace(/'/g,"\\'")}')" style="padding:12px 14px;border-bottom:1px solid #F5F5F5;font-size:13px;cursor:pointer;display:flex;gap:10px;align-items:flex-start;" onmouseover="this.style.background='#FFF8F6'" onmouseout="this.style.background='#fff'"><span style="font-size:14px;flex-shrink:0;margin-top:1px;">${ICONS.pin}</span><div><div style="font-weight:700;color:#0D0D0D;">${linea1}</div>${linea2?`<div style="font-size:11px;color:#9DA3AE;margin-top:2px;">${linea2}</div>`:''}</div></div>`;}).join('');}else{sugs.style.display='none';}}catch{sugs.style.display='none';}},500);}
function elegirDireccion(dir){document.getElementById('dir-nueva-txt').value=dir;document.getElementById('sugerencias-dir').style.display='none';selDireccion('nueva');}
function initAutocomplete(){}function autocompletarDireccion(){}function seleccionarDireccion(d){elegirDireccion(d);}

let starSeleccionada=0;
function mostrarRating(comercioNombre){starSeleccionada=0;document.querySelectorAll('.star').forEach(s=>s.classList.remove('active'));document.getElementById('rating-comentario').value='';document.getElementById('rating-comercio-nombre').textContent=`Calificá a ${comercioNombre}`;document.getElementById('rating-screen').classList.add('visible');}
function selStar(n){starSeleccionada=n;document.querySelectorAll('.star').forEach((s,i)=>s.classList.toggle('active',i<n));}
async function enviarRating(){if(!starSeleccionada){showToast('Elegí una puntuación');return;}const comentario=document.getElementById('rating-comentario').value.trim();try{await sb.from('ratings').insert([{comercio_id:currentComercio?.id,pedido_id:currentPedido?.id,rating:starSeleccionada,comentario}]);}catch(e){}cerrarRating();showToast(`${ICONS.check} ¡Gracias por tu calificación!`,3000);} 
function cerrarRating(){document.getElementById('rating-screen').classList.remove('visible');}

const menusFallback={};

async function abrirComercio(id){const com=allComercios.find(c=>c.id===id);if(!com)return;currentComercio=com;window.state.cart={};document.getElementById('det-name').textContent=com.nombre;document.getElementById('det-meta').textContent=`${com.abierto_ahora?'Abierto':'Cerrado'} · ${com.rating} · ${com.total_pedidos||0} pedidos · Envio desde $1.200`;document.getElementById('cart-comercio-name').textContent=com.nombre;document.getElementById('cart-float').style.display='none';document.getElementById('ratings-comercio').style.display='none';go('detail');cargarRatingsComercio(id);try{const[{data,error},{data:catData}]=await Promise.all([window.sb.from('productos').select('*').eq('comercio_id',id).eq('disponible',true),window.sb.from('categorias_producto').select('id,nombre').eq('comercio_id',id)]);if(error){console.error('[PaP] Error cargando productos:',error.message);document.getElementById('menu-container').innerHTML='<div class="empty"><div class="big">'+(ICONS.warn||'')+'</div><p>Error al cargar el menú. Intentá de nuevo.</p></div>';return;}const cerradoBanner=!com.abierto_ahora?'<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:12px;padding:12px 16px;margin-bottom:12px;font-size:13px;font-weight:600;color:#DC2626;text-align:center;">Cerrado ahora — podés explorar el menú pero no hacer pedidos.</div>':'';if(!data||!data.length){document.getElementById('menu-container').innerHTML=cerradoBanner+'<div class="empty"><div class="big"></div><p>Este comercio no tiene productos disponibles.</p></div>';return;}const catMap=Object.fromEntries((catData||[]).map(c=>[c.id,c.nombre]));const cats=[...new Set(data.map(p=>p.categoria_id||'General'))];document.getElementById('menu-container').innerHTML=cerradoBanner+'<div class="section-card">'+cats.map(cat=>`<div class="menu-cat-label">${catMap[cat]||cat}</div>${data.filter(p=>(p.categoria_id||'General')===cat).map(p=>{const precio=Math.round(Number(p.precio_base??p.precio??0)*1.15);const img=p.imagen_url?`<img src="${p.imagen_url}" style="width:54px;height:54px;object-fit:cover;border-radius:10px;flex-shrink:0;margin-left:8px;" loading="lazy"/>`:'';const addDisabled=!com.abierto_ahora?' disabled style="opacity:.4;cursor:not-allowed;"':'';return`<div class="menu-item"><div style="flex:1;min-width:0;"><div class="mi-name">${p.nombre}</div><div class="mi-desc">${p.descripcion||''}</div></div><div class="mi-right">${img}<div class="mi-price">$${precio.toLocaleString('es-AR')}</div><button class="add-btn" onclick="addCart('${p.id}','${p.nombre.replace(/'/g,"\\'")}',${precio})"${addDisabled}>+</button></div></div>`;}).join('')}`).join('')+'</div>';}catch(e){console.error('[PaP] Excepción al cargar productos:',e);document.getElementById('menu-container').innerHTML='<div class="empty"><div class="big">'+(ICONS.warn||'')+'</div><p>No se pudo cargar el menú. Revisá tu conexión.</p></div>';}}

function addCart(id,nombre,precio){if(!window.state.cart[id])window.state.cart[id]={nombre,precio,qty:0};window.state.cart[id].qty++;const qtyRow=document.getElementById(`qty-row-${id}`);const qtyN=document.getElementById(`qty-n-${id}`);if(qtyRow)qtyRow.style.display='flex';if(qtyN)qtyN.textContent=window.state.cart[id].qty;actualizarCartFloat();showToast('Agregado al carrito');}
function addCartMenu(id,nombre,precio){addCart(id,nombre,precio);}
function cambiarCantMenu(id,nombre,precio,delta){if(!window.state.cart[id])return;window.state.cart[id].qty=Math.max(0,window.state.cart[id].qty+delta);const qtyRow=document.getElementById(`qty-row-${id}`);const qtyN=document.getElementById(`qty-n-${id}`);if(window.state.cart[id].qty===0){delete window.state.cart[id]; window.state.saveCart();if(qtyRow)qtyRow.style.display='none';if(qtyN)qtyN.textContent='0';}else{if(qtyN)qtyN.textContent=window.state.cart[id].qty;}actualizarCartFloat();}
function mostrarConfirmado(numPedido){
  document.getElementById('conf-num-val').textContent=`#${numPedido}`;
  document.getElementById('conf-icono').innerHTML=ICONS.clock;
  document.getElementById('conf-titulo').textContent='Pedido enviado';
  document.getElementById('conf-sub').textContent='Esperando que el comercio confirme tu pedido...';
  document.getElementById('conf-btn').style.display='none';
  document.getElementById('conf-loader').style.display='flex';
  document.getElementById('s-confirmado').classList.add('visible');
}
function pedidoConfirmadoPorComercio(){
  document.getElementById('conf-icono').innerHTML=ICONS.confetti;
  document.getElementById('conf-titulo').textContent='¡Pedido confirmado!';
  document.getElementById('conf-sub').textContent='El comercio aceptó tu pedido.\nYa está siendo preparado';
  document.getElementById('conf-btn').style.display='block';
  document.getElementById('conf-loader').style.display='none';
}
function irAlTracking(){document.getElementById('s-confirmado').classList.remove('visible');iniciarTracking();go('tracking');}
function actualizarCartFloat(){const items=Object.values(window.state.cart);const total=items.reduce((s,i)=>s+i.precio*i.qty,0);const count=items.reduce((s,i)=>s+i.qty,0);const f=document.getElementById('cart-float');if(count>0){f.style.display='flex';document.getElementById('cf-count').textContent=`Ver carrito (${count} producto${count>1?'s':''})`;document.getElementById('cf-total').textContent=`$${total.toLocaleString('es-AR')}`;}else{f.style.display='none';}}
function selPay(el,method){document.querySelectorAll('.pay-opt').forEach(o=>o.classList.remove('sel'));el.classList.add('sel');payMethod=method;}

let dirEntregaSeleccionada='gps';
function cargarDireccionesEnCarrito(){const dirs=JSON.parse(localStorage.getItem('pap_direcciones')||'[]');const cont=document.getElementById('dir-opt-otras');if(cont){cont.innerHTML=dirs.map((d,i)=>`<div id="dir-opt-saved-${i}" onclick="selDireccion('saved-${i}')" style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;border:1.5px solid #E0E0E0;background:#fff;cursor:pointer;"><span style="font-size:20px;"></span><div style="flex:1;"><div style="font-size:13px;font-weight:700;color:#0D0D0D;">${d.nombre}</div><div style="font-size:11px;color:#9DA3AE;margin-top:2px;">${d.dir}</div></div><div style="width:18px;height:18px;border-radius:50%;border:2px solid #E0E0E0;background:#fff;" id="dot-saved-${i}"></div></div>`).join('');}const gpsTxt=document.getElementById('dir-gps-txt');if(gpsTxt)gpsTxt.textContent=ubicacionActual||'Detectando...';}
function selDireccion(tipo){dirEntregaSeleccionada=tipo;document.querySelectorAll('[id^="dot-"]').forEach(d=>{d.style.borderColor='#E0E0E0';d.style.background='#fff';d.innerHTML='';});document.querySelectorAll('[id^="dir-opt-"]').forEach(d=>{if(d.style){d.style.borderColor='#E0E0E0';d.style.background='#fff';}});const dotId=tipo==='gps'?'dot-gps':tipo==='nueva'?'dot-nueva':`dot-${tipo}`;const optId=tipo==='gps'?'dir-opt-gps':tipo==='nueva'?'dir-opt-nueva':`dir-opt-${tipo}`;const dot=document.getElementById(dotId);const opt=document.getElementById(optId);if(dot){dot.style.borderColor='#FF6B35';dot.style.background='#FF6B35';dot.innerHTML='<div style="width:7px;height:7px;border-radius:50%;background:#fff;"></div>';}if(opt){opt.style.borderColor='#FF6B35';opt.style.background='#FFF8F6';}const inputNueva=document.getElementById('input-dir-nueva');if(inputNueva){inputNueva.style.display=tipo==='nueva'?'block':'none';if(tipo==='nueva')setTimeout(()=>document.getElementById('dir-nueva-txt')?.focus(),100);}}
async function obtenerDireccionDesdePin(lat,lng){try{const res=await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=es&addressdetails=1`);const data=await res.json();const a=data.address||{};const calle=a.road||a.pedestrian||'';const numero=a.house_number||'';const barrio=a.suburb||a.neighbourhood||a.village||a.locality||'';const ciudad=a.city||a.town||a.municipality||'';const provincia=a.state||'';const partes=[];if(calle&&numero)partes.push(`${calle} ${numero}`);else if(calle)partes.push(calle);if(barrio&&barrio!==ciudad)partes.push(barrio);if(ciudad)partes.push(ciudad);if(provincia&&provincia!==ciudad)partes.push(provincia);return partes.join(', ')||'Ubicación seleccionada';}catch{return'Ubicación seleccionada';}}
function getDireccionEntrega(){if(dirEntregaSeleccionada==='gps')return ubicacionActual||'Ubicación actual';if(dirEntregaSeleccionada==='nueva'){const txt=document.getElementById('dir-nueva-txt')?.value.trim();return txt||'Dirección no especificada';}const idx=parseInt(dirEntregaSeleccionada.replace('saved-',''));const dirs=JSON.parse(localStorage.getItem('pap_direcciones')||'[]');return dirs[idx]?`${dirs[idx].nombre}: ${dirs[idx].dir}`:ubicacionActual;}
async function actualizarDirGPS(){if(!navigator.geolocation)return;navigator.geolocation.getCurrentPosition(async(pos)=>{const lat=pos.coords.latitude;const lng=pos.coords.longitude;const dir=await obtenerDireccionDesdePin(lat,lng);const gpsTxt=document.getElementById('dir-gps-txt');if(gpsTxt)gpsTxt.textContent=dir;ubicacionActual=dir;localStorage.setItem('pap_ubicacion',dir);cargarMapaCarrito(lat,lng);},()=>{},{enableHighAccuracy:true,maximumAge:0});}

function renderCarrito(){const items=Object.entries(window.state?window.state.cart:{}).filter(([,i])=>i.qty>0);if(!items.length){document.getElementById('cart-list').innerHTML='<div class="empty"><div class="big"></div><p>Tu carrito está vacío.<br>Elegí algo rico.</p></div>';document.getElementById('r-sub').textContent='$0';document.getElementById('r-total').textContent='$1.200';document.getElementById('btn-confirmar').disabled=true;return;}document.getElementById('btn-confirmar').disabled=false;let sub=0;document.getElementById('cart-list').innerHTML='<div class="section-card">'+items.map(([id,item])=>{sub+=item.precio*item.qty;return`<div class="cart-item"><div><div class="ci-name">${item.nombre}</div><div class="ci-sub">$${item.precio.toLocaleString('es-AR')} c/u</div></div><div class="qty-row"><button class="qty-btn" onclick="cambiarQty('${id}',-1)">−</button><span class="qty-n">${item.qty}</span><button class="qty-btn" onclick="cambiarQty('${id}',1)">+</button><span style="font-size:14px;font-weight:700;color:var(--black);min-width:62px;text-align:right;">$${(item.precio*item.qty).toLocaleString('es-AR')}</span></div></div>`;}).join('')+'</div>';const envio=1200;document.getElementById('r-sub').textContent=`$${sub.toLocaleString('es-AR')}`;document.getElementById('r-envio').textContent=`$${envio.toLocaleString('es-AR')}`;
  // 4c: Inyectar selector de propina si el contenedor existe en el HTML
  const tipSec=document.getElementById('tip-section');
  if(tipSec){tipSec.style.display='block';tipSec.innerHTML=`<div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.05em;margin:10px 0 8px;">Propina al repartidor (opcional)</div><div style="display:flex;gap:8px;flex-wrap:wrap;">${[0,200,500,1000].map(amt=>`<button id="tip-btn-${amt}" onclick="selPropina(${amt})" style="padding:8px 14px;border-radius:20px;border:1.5px solid ${propinaSeleccionada===amt?'#FF6B35':'#E0E0E0'};background:${propinaSeleccionada===amt?'#FFF3EE':'#fff'};color:${propinaSeleccionada===amt?'#FF6B35':'#666'};font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">${amt===0?'Sin propina':'$'+amt.toLocaleString('es-AR')}</button>`).join('')}</div>`;}
  document.getElementById('r-total').textContent=`$${(sub+envio+propinaSeleccionada).toLocaleString('es-AR')}`;}

function selPropina(amt){propinaSeleccionada=amt;const envio=1200;const items=Object.values(window.state?window.state.cart:{}).filter(i=>i.qty>0);const sub=items.reduce((s,i)=>s+i.precio*i.qty,0);document.getElementById('r-total').textContent=`$${(sub+envio+propinaSeleccionada).toLocaleString('es-AR')}`;[0,200,500,1000].forEach(a=>{const btn=document.getElementById(`tip-btn-${a}`);if(!btn)return;const sel=a===amt;btn.style.borderColor=sel?'#FF6B35':'#E0E0E0';btn.style.background=sel?'#FFF3EE':'#fff';btn.style.color=sel?'#FF6B35':'#666';});}

function cambiarQty(id,delta){if(!window.state.cart[id])return;window.state.cart[id].qty=Math.max(0,window.state.cart[id].qty+delta);if(window.state.cart[id].qty===0)delete window.state.cart[id]; window.state.saveCart();renderCarrito();actualizarCartFloat();}

async function confirmarPedido(){
  const items=Object.values(window.state.cart).filter(i=>i.qty>0);if(!items.length){showToast('Agregá productos primero');return;}
  const btn=document.getElementById('btn-confirmar');btn.disabled=true;btn.textContent='Procesando...';
  const sub=items.reduce((s,i)=>s+i.precio*i.qty,0);const total=sub+1200+propinaSeleccionada;const nota=document.getElementById('nota-pedido')?.value?.trim()||'';
  let userId=null;try{const{data:{session}}=await sb.auth.getSession();userId=session?.user?.id;}catch{}
  const comercioId=currentComercio?.id;
  const _UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(!comercioId||!_UUID_RE.test(comercioId)){showToast('Recargá la página y volvé a intentar el pedido.',5000);btn.disabled=false;btn.textContent='Confirmar pedido';return;}
  const pedido={comercio_id:comercioId,cliente_id:userId,productos:items,total,estado:'nuevo',direccion_entrega:getDireccionEntrega(),propina_cadete:propinaSeleccionada||0,metodo_pago:payMethod};
  try{const{data,error}=await sb.from('pedidos').insert([pedido]).select().single();if(error){console.error('Error:',error.message);showToast('Error al guardar el pedido: '+error.message,5000);}else{console.log('Pedido guardado:',data);}currentPedido=data||{...pedido,numero:Math.floor(Math.random()*9000)+1000};}catch(e){console.error('Excepcion:',e);currentPedido={...pedido,numero:Math.floor(Math.random()*9000)+1000};}
  const itemsParaPago=[...items];window.state.cart={};actualizarCartFloat();btn.disabled=false;btn.textContent='Confirmar pedido';propinaSeleccionada=0;

  // Notificar al comercio via push (fire & forget)
  if(currentPedido?.id){
    try{
      const{data:{session:s}}=await sb.auth.getSession();
      if(s?.access_token){fetch((window.BACKEND_URL||'')+'/api/pedidos/notificar-comercio',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+s.access_token},body:JSON.stringify({pedido_id:currentPedido.id})}).catch(()=>{});}
    }catch{}
  }

  // Escuchar cuando el comercio acepta el pedido
  if(currentPedido?.id){
    const pedidoId=currentPedido.id;
    const ch=sb.channel('pedido-confirmado-'+pedidoId)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'pedidos',filter:`id=eq.${pedidoId}`},(payload)=>{
        if(payload.new.estado==='preparando'){
          pedidoConfirmadoPorComercio();
          sb.removeChannel(ch);
        }
      }).subscribe();
    // También hacer polling como fallback
    const poll=setInterval(async()=>{
      try{
        const{data}=await sb.from('pedidos').select('estado').eq('id',pedidoId).single();
        if(data?.estado==='preparando'||data?.estado==='en_camino'||data?.estado==='entregado'){
          pedidoConfirmadoPorComercio();
          clearInterval(poll);
        }
      }catch{}
    },5000);
  }

  if(payMethod==='mercadopago'){const cartSub=itemsParaPago.reduce((s,i)=>s+i.precio*i.qty,0);localStorage.setItem('pap_pedido_pago',JSON.stringify({items:itemsParaPago.map(i=>({nombre:i.nombre,qty:i.qty,precio:i.precio,quantity:i.qty,unit_price:i.precio,title:i.nombre})),total:cartSub+800+propinaSeleccionada,propina_cadete:propinaSeleccionada||0,envio:800,comercio:currentComercio?.nombre||'Comercio'}));localStorage.setItem('pap_pedido_actual',currentPedido?.id||'');window.location.href='pago.html';return;}
  if(payMethod==='efectivo'){
    mostrarConfirmado(currentPedido?.numero||Math.floor(Math.random()*9000)+1000);
    setTimeout(()=>{
      const confMsg=document.getElementById('conf-msg');
      if(confMsg) confMsg.innerHTML='Tene preparado <strong>$'+total.toLocaleString('es-AR')+'</strong> en efectivo para pagarle al cadete cuando llegue.';
    },100);
    return;
  }
  mostrarConfirmado(currentPedido?.numero||Math.floor(Math.random()*9000)+1000);
}

// 4d: Fetch pedido con perfil del cadete desde el backend (GET /api/pedidos/:id)
async function fetchPedidoConCadete(pedidoId){
  try{
    const{data:{session}}=await sb.auth.getSession();
    if(!session?.access_token)return null;
    const base=window.BACKEND_URL||'';
    const r=await fetch(`${base}/api/pedidos/${pedidoId}`,{headers:{'Authorization':`Bearer ${session.access_token}`}});
    if(!r.ok)return null;
    return await r.json();
  }catch{return null;}
}

// 4d: Poblar card de cadete en el tracking view con datos del perfil
function poblarCadeteCard(pedido){
  if(!pedido||!pedido.cadete_perfil)return;
  const p=pedido.cadete_perfil;
  const cadNombre=document.getElementById('cad-nombre');
  const cadSub=document.getElementById('cad-sub');
  const cadAvatar=document.getElementById('cad-avatar');
  if(cadNombre){const nombre=[p.nombre,p.apellido].filter(Boolean).join(' ');cadNombre.textContent=nombre||'Tu repartidor';}
  if(cadSub&&!cadSub.textContent.includes('km')){const veh=[p.vehiculo,p.color].filter(Boolean).join(' · ');if(veh)cadSub.textContent=veh;}
  if(cadAvatar&&p.avatar_url){cadAvatar.src=p.avatar_url;cadAvatar.style.display='block';}
}

function iniciarTracking(){
  // ── Limpiar sesión de tracking anterior ──────────────────────────────────
  if(trackInterval){clearInterval(trackInterval);trackInterval=null;}
  if(window._trackPedidoCh){try{sb.removeChannel(window._trackPedidoCh);}catch{}window._trackPedidoCh=null;}
  if(window._trackGpsCh){try{sb.removeChannel(window._trackGpsCh);}catch{}window._trackGpsCh=null;}

  const pedidoId=currentPedido?.id;
  const num=currentPedido?.numero||'—';
  const fmt=d=>d.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})+' hs';

  // ── Helpers de UI ─────────────────────────────────────────────────────────
  const activarDot=(n,ts)=>{
    const dot=document.getElementById(`dot${n}`);
    const line=document.getElementById(`line${n}`);
    const lbl=document.getElementById(`lbl${n}`);
    const t=document.getElementById(`t${n}`);
    if(dot)dot.style.cssText='background:#FF6B35;border:none;width:18px;height:18px;border-radius:50%;';
    if(line)line.style.background='#FF6B35';
    if(lbl)lbl.style.color='var(--black)';
    if(t&&!t.textContent)t.textContent=fmt(ts||new Date());
  };

  // Estado inicial de la pantalla
  document.getElementById('track-title').textContent=`Pedido #${num} confirmado`;
  document.getElementById('track-sub').textContent='Esperando que el comercio acepte...';
  activarDot(1);

  // 4a: Código de entrega leído del servidor — nunca generado en cliente
  const mostrarCodigoEntrega=codigo=>{
    if(!codigo)return;
    document.getElementById('cod-entrega-box').style.display='block';
    document.getElementById('cod-digits').innerHTML=String(codigo).split('').map(d=>`<div class="cod-digit">${d}</div>`).join('');
  };

  // ── Haversine: distancia en km entre dos coordenadas GPS ──────────────────
  const haversineKm=(lat1,lng1,lat2,lng2)=>{
    const R=6371,dLat=(lat2-lat1)*Math.PI/180,dLng=(lng2-lng1)*Math.PI/180;
    const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  };

  // ── Actualizar UI según el estado real del pedido ─────────────────────────
  const actualizarEstado=estado=>{
    if(!estado)return;
    if(['en_preparacion','preparando'].includes(estado)){
      activarDot(2);
      document.getElementById('track-sub').textContent='El comercio está preparando tu pedido';
    }
    if(estado==='cadete_asignado'){
      activarDot(2);
      document.getElementById('track-sub').textContent='Cadete asignado — va a buscar tu pedido';
      document.getElementById('cadete-info').style.display='flex';
      // 4d: Cargar identidad del cadete
      if(pedidoId){fetchPedidoConCadete(pedidoId).then(poblarCadeteCard).catch(()=>{});}
    }
    if(estado==='en_camino'){
      activarDot(2);activarDot(3);
      document.getElementById('track-sub').textContent='Tu cadete está en camino';
      document.getElementById('cadete-info').style.display='flex';
      // 4a+4d: Leer código de entrega e identidad del cadete desde el servidor
      if(pedidoId){
        fetchPedidoConCadete(pedidoId).then(p=>{
          if(p?.codigo_entrega) mostrarCodigoEntrega(p.codigo_entrega);
          poblarCadeteCard(p);
        }).catch(()=>{});
      }
    }
    if(estado==='entregado'){
      activarDot(2);activarDot(3);activarDot(4);
      document.getElementById('track-sub').textContent='¡Pedido entregado!';
      // Cerrar canales Realtime al finalizar el viaje
      if(window._trackPedidoCh){try{sb.removeChannel(window._trackPedidoCh);}catch{}window._trackPedidoCh=null;}
      if(window._trackGpsCh){try{sb.removeChannel(window._trackGpsCh);}catch{}window._trackGpsCh=null;}
      showToast('¡Tu pedido fue entregado!',3000);
      try{mostrarBotonDevolucion();}catch{}
      setTimeout(()=>{try{mostrarRating(currentComercio?.nombre||'el comercio');}catch{}},1000);
    }
  };

  // Aplicar estado actual inmediatamente si ya lo tenemos
  if(currentPedido?.estado)actualizarEstado(currentPedido.estado);

  // Sin pedido real: nada que suscribir
  if(!pedidoId||!sb?.channel){
    document.getElementById('track-sub').textContent='Conectando con el pedido...';
    return;
  }

  // ── Suscripción 1: cambios de estado del pedido (postgres_changes) ────────
  window._trackPedidoCh=sb
    .channel(`track-pedido-${pedidoId}`)
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'pedidos',filter:`id=eq.${pedidoId}`},
      payload=>{
        console.log('[Tracking] Estado pedido:',payload.new?.estado);
        actualizarEstado(payload.new?.estado);
      })
    .subscribe();

  // ── Obtener posición GPS del cliente (para calcular ETA real + mapa) ─────
  let clienteLat=null,clienteLng=null;
  if(navigator.geolocation){
    navigator.geolocation.getCurrentPosition(
      pos=>{
        clienteLat=pos.coords.latitude;
        clienteLng=pos.coords.longitude;
        initTrackingMap(clienteLat,clienteLng);
      },
      ()=>{ initTrackingMap(null,null); }
    );
  }else{
    initTrackingMap(null,null);
  }

  // ── Suscripción 2: GPS del cadete en tiempo real (ubicacion_cadetes) ─────
  window._trackGpsCh=sb
    .channel(`track-gps-${pedidoId}`)
    .on('postgres_changes',{event:'*',schema:'public',table:'ubicacion_cadetes',filter:`pedido_id=eq.${pedidoId}`},
      payload=>{
        const{lat,lng}=payload.new||{};
        if(lat==null||lng==null)return;
        console.log(`[Tracking] GPS cadete: ${lat}, ${lng}`);

        // Mover marcador del cadete en el mapa Leaflet
        moverCadeteEnMapa(lat,lng);

        // Mostrar tarjeta del cadete si estaba oculta
        document.getElementById('cadete-info').style.display='flex';

        // Calcular distancia y ETA con Haversine si tenemos coords del cliente
        if(clienteLat&&clienteLng){
          const distKm=haversineKm(Number(lat),Number(lng),clienteLat,clienteLng);
          const etaMin=Math.max(1,Math.ceil((distKm/30)*60)); // 30 km/h promedio moto
          const distStr=distKm<1?`${Math.round(distKm*1000)} m`:`${distKm.toFixed(1)} km`;
          document.getElementById('cad-sub').textContent=`A ${distStr} — ~${etaMin} min`;
          document.getElementById('track-sub').textContent=`Tu cadete está a ${distStr}`;
        }else{
          // Sin coords del cliente: mostrar que el GPS está activo
          document.getElementById('cad-sub').textContent='GPS activo — calculando ruta...';
        }
      })
    .subscribe(status=>{
      console.log('[Tracking] Canal GPS suscripto:',status);
    });
}

async function cargarPedidos(){
  const container=document.getElementById('pedidos-list');
  container.innerHTML='<div class="loader">Cargando pedidos...</div>';
  try{
    const{data:{session}}=await sb.auth.getSession();
    const userId=session?.user?.id;
    if(!userId)throw new Error('sin sesion');
    const{data}=await sb.from('pedidos').select('*,comercios(nombre,imagen_url)').eq('cliente_id',userId).order('created_at',{ascending:false}).limit(30);
    if(!data||!data.length)throw new Error('vacío');
    let reportesActivos={};
    try{const ids=data.map(p=>p.id).filter(Boolean);if(ids.length){const{data:reps}=await sb.from('reportes').select('*').in('pedido_id',ids).eq('estado','pendiente');(reps||[]).forEach(r=>{reportesActivos[r.pedido_id]=r;});}}catch{}
  const estadoConfig={entregado:{clase:'ep-entregado',label:'Entregado',icon:ICONS.check},cancelado:{clase:'ep-cancelado',label:'Cancelado',icon:ICONS.close},en_camino:{clase:'ep-camino',label:'En camino',icon:ICONS.scooter},preparando:{clase:'ep-camino',label:'Preparando',icon:ICONS.plate},nuevo:{clase:'ep-camino',label:'Confirmado',icon:ICONS.confetti}};
    container.innerHTML=data.map(p=>{
      const est=estadoConfig[p.estado]||estadoConfig.nuevo;
      const items=Array.isArray(p.productos)?p.productos:Array.isArray(p.items)?p.items:[];
      const itemsStr=items.map(i=>`${i.qty||i.cantidad||1}x ${i.nombre||i.name||'—'}`).join(', ');
      const fecha=new Date(p.created_at).toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'2-digit'});
      const hora=new Date(p.created_at).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'});
      const reporte=reportesActivos[p.id];
      const chatBtn=reporte?`<button onclick="event.stopPropagation();reabrirChat('${reporte.id}','${reporte.tipo}','${reporte.limite_resolucion||''}')" style="width:100%;margin-top:10px;background:#FEF3C7;color:#92400E;border:none;border-radius:10px;padding:10px;font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;">Ver chat del reporte activo</button>`:'';
      const activo=['nuevo','preparando','en_camino'].includes(p.estado);
      const repeatBtn=p.estado==='entregado'?`<button onclick="event.stopPropagation();repetirPedido('${p.comercio_id}')" style="margin-top:10px;width:100%;background:#FF6B35;color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;font-weight:700;cursor:pointer;">Repetir pedido</button>`:'';
  return`<div class="ped-card" onclick="${activo?"go('tracking')":`verDetallePedido('${p.id}')`}"><div class="ped-top"><div class="ped-name">${est.icon} ${p.comercios?.nombre||'Comercio'}</div><span class="estado-pill ${est.clase}">${est.label}</span></div><div style="font-size:12px;color:var(--gray-600);margin-bottom:6px;line-height:1.5;">${itemsStr||'Sin detalle'}</div><div style="display:flex;justify-content:space-between;align-items:center;"><div class="ped-meta">${ICONS.calendar} ${fecha} · ${ICONS.clock} ${hora}</div><div style="font-size:14px;font-weight:800;color:var(--brand);">$${Number(p.total||0).toLocaleString('es-AR')}</div></div>${p.notas?`<div style="margin-top:6px;font-size:11px;color:var(--gray-400);background:var(--gray-50);border-radius:8px;padding:6px 10px;">${ICONS.chat} ${p.notas}</div>`:''}${chatBtn}${repeatBtn}</div>`;
    }).join('');
  }catch{
    if(currentPedido){container.innerHTML=`<div class="ped-card" onclick="go('tracking')"><div class="ped-top"><div class="ped-name">${currentComercio?.nombre||'Tu pedido'}</div><span class="estado-pill ep-camino">En camino</span></div><div class="ped-meta">$${Number(currentPedido.total||0).toLocaleString('es-AR')} · Hoy</div></div>`;}
    else{container.innerHTML='<div class="empty"><div class="big"></div><p>Todavía no hiciste ningún pedido.<br>¡Animate a pedir algo!</p></div>';}
  }
}

function verDetallePedido(id){go('pedido-detalle');cargarDetallePedido(id);}

async function cargarDetallePedido(pedidoId){
  const cont=document.getElementById('pedido-detalle-content');if(!cont)return;
  cont.innerHTML='<div class="loader">Cargando...</div>';
  try{
    const{data:p}=await sb.from('pedidos').select('*,comercios(nombre,imagen_url,categoria)').eq('id',pedidoId).single();
    if(!p)throw new Error('no encontrado');
    const items=Array.isArray(p.productos)?p.productos:Array.isArray(p.items)?p.items:[];
    const fecha=new Date(p.created_at).toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'2-digit'});
    const hora=new Date(p.created_at).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'});
    const metodoIcon={mercadopago:'MercadoPago',efectivo:'Efectivo',transferencia:'Transferencia'};
    const estadoConfig={entregado:{label:'Entregado',color:'#16A34A',bg:'#DCFCE7'},cancelado:{label:'Cancelado',color:'#DC2626',bg:'#FEE2E2'},en_camino:{label:'En camino',color:'#1B5E20',bg:'#E8F5E9'},preparando:{label:'Preparando',color:'#1565C0',bg:'#E3F2FD'},nuevo:{label:'Confirmado',color:'#E65100',bg:'#FFF3E0'}};
    const est=estadoConfig[p.estado]||estadoConfig.nuevo;
    cont.innerHTML=`<div style="background:#fff;border-radius:var(--radius-lg);overflow:hidden;border:1px solid var(--gray-100);margin-bottom:14px;"><div style="padding:16px;border-bottom:1px solid var(--gray-100);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;"><div style="font-size:16px;font-weight:800;color:var(--black);">${p.comercios?.nombre||'Comercio'}</div><span style="font-size:12px;font-weight:700;padding:5px 12px;border-radius:20px;background:${est.bg};color:${est.color};">${est.label}</span></div><div style="font-size:12px;color:var(--gray-400);">${fecha} · ${hora} hs · Pedido #${p.numero||'—'}</div></div><div style="padding:16px;border-bottom:1px solid var(--gray-100);"><div style="font-size:11px;font-weight:700;color:var(--brand);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Productos</div>${items.map(i=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--gray-50);"><span style="font-size:13px;color:var(--black);">${i.qty||1}x ${i.nombre}</span><span style="font-size:13px;font-weight:700;color:var(--black);">$${Number((i.precio||0)*(i.qty||1)).toLocaleString('es-AR')}</span></div>`).join('')}</div><div style="padding:16px;border-bottom:1px solid var(--gray-100);"><div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;color:var(--gray-600);"><span>Subtotal</span><span>$${Number(p.subtotal||0).toLocaleString('es-AR')}</span></div><div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;color:var(--gray-600);"><span>Envío</span><span>$${Number(p.costo_envio||1200).toLocaleString('es-AR')}</span></div><div style="display:flex;justify-content:space-between;font-size:16px;font-weight:800;padding:8px 0 0;border-top:1.5px solid var(--gray-200);margin-top:4px;"><span>Total</span><span style="color:var(--brand);">$${Number(p.total||0).toLocaleString('es-AR')}</span></div></div><div style="padding:16px;"><div style="font-size:12px;color:var(--gray-400);margin-bottom:4px;">Método de pago</div><div style="font-size:13px;font-weight:600;">${metodoIcon[p.metodo_pago]||p.metodo_pago||'—'}</div>${p.direccion_entrega?`<div style="margin-top:10px;"><div style="font-size:12px;color:var(--gray-400);margin-bottom:4px;">Dirección de entrega</div><div style="font-size:13px;font-weight:600;">${p.direccion_entrega}</div></div>`:''} ${p.notas?`<div style="margin-top:10px;background:var(--gray-50);border-radius:8px;padding:10px 12px;"><div style="font-size:12px;color:var(--gray-400);margin-bottom:2px;">Nota al comercio</div><div style="font-size:13px;">${p.notas}</div></div>`:''}</div></div>${p.estado==='entregado'?`<button onclick="repetirPedido('${p.comercio_id}')" style="width:100%;background:var(--brand);color:#fff;border:none;border-radius:var(--radius-md);padding:14px;font-size:15px;font-weight:800;cursor:pointer;margin-bottom:10px;">Repetir este pedido</button>`:''}`;
  }catch{cont.innerHTML='<div class="empty"><div class="big"></div><p>No se pudo cargar el detalle.</p></div>';}
}

function repetirPedido(comercioId){const com=allComercios.find(c=>c.id===comercioId);if(com){abrirComercio(com.id);showToast('Abriendo el comercio...');}else{showToast('El comercio ya no está disponible');}}

async function reabrirChat(reporteId,tipo,limiteStr){const tipoLabel={'no-llegó':'No llegó lo pedido','mal-estado':'Llegó en mal estado','faltó-algo':'Faltó algo','no-llegó-pedido':'No recibió el pedido'};await abrirChatReporte(reporteId,tipoLabel[tipo]||tipo,limiteStr);}

async function cerrarSesion(){if(!confirm('¿Querés cerrar sesión?'))return;try{await sb.auth.signOut();}catch(e){}localStorage.clear();window.location.href='login-usuario.html';}

window.addEventListener('load', () => {
  // Sincronizar ICONS ahora que main.js (módulo) ya ejecutó
  if (window.ICONS) ICONS = window.ICONS;

  const _sb = window.sb;
  if (!_sb || !_sb.auth) {
    console.error('[PaP] window.sb no disponible en load — redirigiendo a login');
    window.location.href = 'login-usuario.html';
    return;
  }

  _sb.auth.getSession().then(async ({data:{session}})=>{
    if(!session){window.location.href='login-usuario.html';return;}
    const user=session.user;
    let rol=user.user_metadata?.role || null;

    // Si no tiene rol, consultar perfiles (fuente de verdad)
    if(!rol){
      try{
        const{data:perfil}=await sb.from('perfiles').select('rol').eq('usuario_id',user.id).maybeSingle();
        if(perfil?.rol) rol=perfil.rol;
      }catch{}
    }

    // Si sigue sin rol, asignar 'cliente' automaticamente via backend
    if(!rol){
      try{
        const sess=await sb.auth.getSession();
        const token=sess.data?.session?.access_token;
        if(token){
          await fetch((window.BACKEND_URL||'')+'/api/auth/set-role',{
            method:'POST',
            headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
            body:JSON.stringify({role:'cliente'}),
          });
          rol='cliente';
        }
      }catch(e){console.error('Auto-assign role failed:',e);}
    }

    if(!rol){
      mostrarSelectorRol(user);
      return;
    }
    if(rol==='comercio'){window.location.href='../comercio/comercio.html';return;}
    if(rol==='cadete'){window.location.href='../cadete/cadete.html';return;}
  cargarPerfil(user);detectarUbicacion();cargarOfertasBanner();
  // start realtime updates for patrocinios so the hero carousel refreshes live
  try{ setupPatrociniosRealtime(); }catch(e){ console.error('Failed to setup patrocinios realtime', e); }
  });
});

function mostrarSelectorRol(user){const overlay=document.createElement('div');overlay.id='rol-overlay';overlay.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.85);display:flex;align-items:flex-end;justify-content:center;';overlay.innerHTML=`<div style="background:#fff;border-radius:28px 28px 0 0;padding:32px 24px 48px;width:100%;max-width:430px;"><div style="font-size:22px;font-weight:800;color:#0D0D0D;margin-bottom:8px;text-align:center;">¡Bienvenido! ¿Quién sos?</div><div style="font-size:14px;color:#A0A0A0;margin-bottom:28px;text-align:center;line-height:1.5;">Elegí tu tipo de cuenta para continuar.</div><div style="display:flex;flex-direction:column;gap:12px;"><button onclick="elegirRol('usuario')" style="display:flex;align-items:center;gap:16px;padding:18px 20px;border-radius:16px;border:2px solid #E0E0E0;background:#fff;cursor:pointer;text-align:left;width:100%;"><div style="width:48px;height:48px;border-radius:14px;background:#FFF3EE;display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;"></div><div><div style="font-size:15px;font-weight:700;color:#0D0D0D;">Usuario</div><div style="font-size:12px;color:#A0A0A0;margin-top:3px;">Quiero pedir delivery a domicilio</div></div></button><button onclick="elegirRol('comercio')" style="display:flex;align-items:center;gap:16px;padding:18px 20px;border-radius:16px;border:2px solid #E0E0E0;background:#fff;cursor:pointer;text-align:left;width:100%;"><div style="width:48px;height:48px;border-radius:14px;background:#EEF3FF;display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;"></div><div><div style="font-size:15px;font-weight:700;color:#0D0D0D;">Comercio</div><div style="font-size:12px;color:#A0A0A0;margin-top:3px;">Tengo un negocio y quiero vender</div></div></button><button onclick="elegirRol('cadete')" style="display:flex;align-items:center;gap:16px;padding:18px 20px;border-radius:16px;border:2px solid #E0E0E0;background:#fff;cursor:pointer;text-align:left;width:100%;"><div style="width:48px;height:48px;border-radius:14px;background:#EEFFF5;display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;"></div><div><div style="font-size:15px;font-weight:700;color:#0D0D0D;">Cadete</div><div style="font-size:12px;color:#A0A0A0;margin-top:3px;">Quiero repartir y ganar dinero</div></div></button></div></div>`;document.body.appendChild(overlay);window._rolUser=user;}

async function elegirRol(rol){
  try{ document.getElementById('rol-overlay')?.remove(); }catch(e){}

  if (rol === 'cadete') {
    window.location.href = '/cadete/cadete.html';
    return;
  }
  if (rol === 'comercio') {
    window.location.href = '/comercio/registro-comercio.html';
    return;
  }

  // Usuario/cliente: asignar rol via backend y recargar
  try {
    const sess = await sb.auth.getSession();
    const token = sess.data?.session?.access_token;
    if (token) {
      await fetch((window.BACKEND_URL||'') + '/api/auth/set-role', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+token },
        body: JSON.stringify({ role: 'cliente' }),
      });
    }
  } catch(e) { console.error('Error asignando rol:', e); }
  window.location.reload();
}

function cargarPerfil(user){const nombre=user.user_metadata?.full_name||user.email?.split('@')[0]||'Usuario';const inicial=nombre.charAt(0).toUpperCase();document.querySelectorAll('.perfil-av').forEach(el=>el.textContent=inicial);const elAv=document.getElementById('perfil-av');const elNombre=document.getElementById('perfil-nombre');const elEmail=document.getElementById('perfil-email');if(elAv)elAv.textContent=inicial;if(elNombre)elNombre.textContent=nombre;if(elEmail)elEmail.textContent=user.email||'';verificarAlertasCliente();
const rol=user.user_metadata?.role;if(rol==='embajador'){const b=document.getElementById('btn-volver-embajador');if(b)b.style.display='flex';}}

function verificarAlertasCliente(){
  const container=document.getElementById('alertas-cliente');
  if(!container)return;
  const alertas=[];
  const dirs=JSON.parse(localStorage.getItem('pap_direcciones')||'[]');
  if(!dirs.length){
    alertas.push({color:'#D97706',bg:'#FFFBEB',border:'#FDE68A',
      icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D97706" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>',
      text:'No tenes direcciones guardadas. Agrega una para pedir mas rapido.',
      btn:'Agregar',onclick:"abrirPantallaExtra('direcciones')"});
  }
  if(!localStorage.getItem('pap_metodo_pago')){
    alertas.push({color:'#2563EB',bg:'#EFF6FF',border:'#BFDBFE',
      icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563EB" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
      text:'No elegiste un metodo de pago preferido.',
      btn:'Elegir',onclick:"abrirPantallaExtra('pagos')"});
  }
  if(!alertas.length){container.innerHTML='';return;}
  container.innerHTML=alertas.map(a=>`
    <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:${a.bg};border:1px solid ${a.border};border-radius:10px;">
      <div style="flex-shrink:0;">${a.icon}</div>
      <div style="flex:1;font-size:11px;color:${a.color};font-weight:500;line-height:1.4;">${a.text}</div>
      <button onclick="${a.onclick}" style="flex-shrink:0;background:${a.color};color:#fff;border:none;border-radius:6px;padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">${a.btn}</button>
    </div>`).join('');
}

let direcciones=JSON.parse(localStorage.getItem('pap_direcciones')||'[]');
let metodoPagoGuardado=localStorage.getItem('pap_metodo_pago')||'';
let notifPedidos=localStorage.getItem('pap_notif_pedidos')!=='false';
let notifPromos=localStorage.getItem('pap_notif_promos')!=='false';

function abrirPantallaExtra(tipo){const panel=document.getElementById('pantalla-extra');const titulo=document.getElementById('extra-titulo');const contenido=document.getElementById('extra-contenido');panel.style.display='block';window.scrollTo(0,0);if(tipo==='direcciones'){titulo.textContent='Mis direcciones';contenido.innerHTML=`<div style="background:#fff;border-radius:14px;padding:16px;border:1px solid #E2E4E8;margin-bottom:14px;">${direcciones.length?direcciones.map((d,i)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #F0F1F3;"><div><div style="font-size:14px;font-weight:700;color:#0D0D0D;">${d.nombre}</div><div style="font-size:12px;color:#9DA3AE;margin-top:3px;">${d.dir}</div></div><button onclick="borrarDireccion(${i})" style="background:#FEE2E2;color:#DC2626;border:none;border-radius:8px;padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer;">Borrar</button></div>`).join(''):'<div style="text-align:center;padding:24px;color:#9DA3AE;font-size:14px;">No tenés direcciones guardadas</div>'}</div><div style="background:#fff;border-radius:14px;padding:16px;border:1px solid #E2E4E8;"><div style="font-size:13px;font-weight:700;color:#0D0D0D;margin-bottom:12px;">Agregar dirección</div><input id="dir-nombre" placeholder="Nombre (ej: Casa, Trabajo)" style="width:100%;border:1.5px solid #E0E0E0;border-radius:10px;padding:12px 14px;font-size:14px;margin-bottom:10px;outline:none;"/><input id="dir-calle" placeholder="Calle y número" style="width:100%;border:1.5px solid #E0E0E0;border-radius:10px;padding:12px 14px;font-size:14px;margin-bottom:12px;outline:none;"/><button onclick="guardarDireccion()" style="width:100%;background:#FF6B35;color:#fff;border:none;border-radius:10px;padding:14px;font-size:14px;font-weight:700;cursor:pointer;">Guardar dirección</button></div>`;}else if(tipo==='pagos'){titulo.textContent='Métodos de pago';contenido.innerHTML=`<div style="background:#fff;border-radius:14px;padding:16px;border:1px solid #E2E4E8;margin-bottom:14px;">${['mercadopago','efectivo','transferencia'].map(m=>`<div onclick="selMetodoPago('${m}')" style="display:flex;align-items:center;gap:14px;padding:14px 0;border-bottom:1px solid #F0F1F3;cursor:pointer;"><div style="width:40px;height:40px;border-radius:12px;background:${m==='mercadopago'?'#E6F0FF':m==='efectivo'?'#E8F5E9':'#FEF3C7'};display:flex;align-items:center;justify-content:center;font-size:20px;">${m==='mercadopago'?'MP':m==='efectivo'?'$':'T'}</div><div style="flex:1;font-size:14px;font-weight:600;color:#0D0D0D;">${m==='mercadopago'?'MercadoPago':m==='efectivo'?'Efectivo':'Transferencia'}</div><div style="width:20px;height:20px;border-radius:50%;border:2px solid ${metodoPagoGuardado===m?'#FF6B35':'#E0E0E0'};background:${metodoPagoGuardado===m?'#FF6B35':'#fff'};display:flex;align-items:center;justify-content:center;">${metodoPagoGuardado===m?'<div style="width:8px;height:8px;border-radius:50%;background:#fff;"></div>':''}</div></div>`).join('')}</div>`;}else if(tipo==='notificaciones'){titulo.textContent='Notificaciones';contenido.innerHTML=`<div style="background:#fff;border-radius:14px;border:1px solid #E2E4E8;overflow:hidden;"><div style="display:flex;justify-content:space-between;align-items:center;padding:16px;"><div><div style="font-size:14px;font-weight:700;color:#0D0D0D;">Estado de pedidos</div><div style="font-size:12px;color:#9DA3AE;margin-top:3px;">Cuando tu pedido cambia de estado</div></div><div onclick="toggleNotif('pedidos')" style="width:48px;height:26px;border-radius:13px;background:${notifPedidos?'#FF6B35':'#E0E0E0'};cursor:pointer;position:relative;"><div style="width:22px;height:22px;border-radius:50%;background:#fff;position:absolute;top:2px;${notifPedidos?'right:2px;':'left:2px;'}"></div></div></div><div style="border-top:1px solid #F0F1F3;display:flex;justify-content:space-between;align-items:center;padding:16px;"><div><div style="font-size:14px;font-weight:700;color:#0D0D0D;">Promociones y ofertas</div><div style="font-size:12px;color:#9DA3AE;margin-top:3px;">Descuentos y novedades de comercios</div></div><div onclick="toggleNotif('promos')" style="width:48px;height:26px;border-radius:13px;background:${notifPromos?'#FF6B35':'#E0E0E0'};cursor:pointer;position:relative;"><div style="width:22px;height:22px;border-radius:50%;background:#fff;position:absolute;top:2px;${notifPromos?'right:2px;':'left:2px;'}"></div></div></div></div>`;}}
function cerrarPantallaExtra(){document.getElementById('pantalla-extra').style.display='none';}
function guardarDireccion(){const nombre=document.getElementById('dir-nombre').value.trim();const dir=document.getElementById('dir-calle').value.trim();if(!nombre||!dir){showToast('Completá los dos campos');return;}direcciones.push({nombre,dir});localStorage.setItem('pap_direcciones',JSON.stringify(direcciones));showToast('Direccion guardada');abrirPantallaExtra('direcciones');}
function borrarDireccion(i){direcciones.splice(i,1);localStorage.setItem('pap_direcciones',JSON.stringify(direcciones));abrirPantallaExtra('direcciones');}
function selMetodoPago(m){metodoPagoGuardado=m;localStorage.setItem('pap_metodo_pago',m);showToast('Metodo de pago guardado');abrirPantallaExtra('pagos');}
function toggleNotif(tipo){if(tipo==='pedidos'){notifPedidos=!notifPedidos;localStorage.setItem('pap_notif_pedidos',notifPedidos);}else{notifPromos=!notifPromos;localStorage.setItem('pap_notif_promos',notifPromos);}abrirPantallaExtra('notificaciones');}

let ubicacionActual='';
localStorage.removeItem('pap_ubicacion');
function setUbicacionTexto(txt){ubicacionActual=txt;localStorage.setItem('pap_ubicacion',txt);document.getElementById('ubicacion-txt').textContent=txt.length>22?txt.slice(0,22)+'…':txt;}
const GMAPS_KEY='AIzaSyASBhagsg9KOoRLRaXmI8BEw9VMvf3dQo0';

async function detectarUbicacion(){
  if(!navigator.geolocation){setUbicacionTexto(localStorage.getItem('pap_ubicacion')||'Mi ubicación');return;}
  document.getElementById('ubicacion-txt').textContent='Detectando...';
  navigator.geolocation.getCurrentPosition(async(pos)=>{
    try{const{latitude:lat,longitude:lng}=pos.coords;const res=await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GMAPS_KEY}&language=es`);const data=await res.json();
    if(data.status==='OK'&&data.results.length>0){let lugar=null,ciudadFinal=null,provinciaFinal=null;for(const result of data.results){const c=result.address_components;if(c.some(x=>x.types.includes('plus_code')))continue;const barrio=c.find(x=>x.types.includes('locality')||x.types.includes('sublocality')||x.types.includes('neighborhood'))?.long_name;const ciudad=c.find(x=>x.types.includes('administrative_area_level_2'))?.long_name;const prov=c.find(x=>x.types.includes('administrative_area_level_1'))?.long_name;if(barrio||ciudad){lugar=barrio;ciudadFinal=ciudad;provinciaFinal=prov;break;}}if(!lugar&&!ciudadFinal){const c=data.results[0].address_components;lugar=c.find(x=>x.types.includes('locality')||x.types.includes('sublocality'))?.long_name;ciudadFinal=c.find(x=>x.types.includes('administrative_area_level_2'))?.long_name;provinciaFinal=c.find(x=>x.types.includes('administrative_area_level_1'))?.long_name;}const partes=[];if(lugar&&lugar!==ciudadFinal)partes.push(lugar);if(ciudadFinal)partes.push(ciudadFinal);if(provinciaFinal&&provinciaFinal!==ciudadFinal&&provinciaFinal!==lugar)partes.push(provinciaFinal);setUbicacionTexto(partes.join(', ')||'Mi ubicación');}else{setUbicacionTexto('Mi ubicación');}}catch{setUbicacionTexto('Mi ubicación');}
  },(err)=>{setUbicacionTexto('Activar ubicacion');},{timeout:10000,maximumAge:0,enableHighAccuracy:true});
}
function pedirUbicacion(){document.getElementById('ubicacion-txt').textContent='Detectando...';detectarUbicacion();}

let bannerIdx=0;let bannerItems=[];let bannerAutoInterval=null;
// Realtime channel reference for patrocinios
let patrociniosChannel = null;

function renderBannerSlides(items){
  bannerItems = items || [];
  const heroEl = document.getElementById('hero-banner');
  const slidesEl = document.getElementById('banner-slides');
  const dotsEl = document.getElementById('banner-dots');
  if(!slidesEl || !dotsEl) return;
  if(!bannerItems.length){ if(heroEl) heroEl.style.display='none'; return; }
  if(heroEl) heroEl.style.display='block';
  slidesEl.innerHTML = bannerItems.map(b=>{
    const title = b.titulo || '';
    const sub = b.sub_titulo || '';
    const img = b.imagen_url || '';
    const link = b.link_oferta || '#';
    return `<div style="min-width:100%;position:relative;"><a href="${link}" style="display:block;width:100%;height:100%"><img src="${img}" alt="${title}" style="width:100%;height:160px;object-fit:cover;display:block;filter:brightness(.6);"/></a><div style="position:absolute;inset:0;background:linear-gradient(135deg,rgba(0,0,0,.75) 0%,rgba(0,0,0,.1) 100%);"></div><div style="position:absolute;top:8px;left:12px;background:var(--brand);color:#fff;font-size:9px;font-weight:800;padding:3px 8px;border-radius:20px;letter-spacing:.06em;">PATROCINADO</div><div style="position:absolute;inset:0;padding:32px 16px 16px;display:flex;flex-direction:column;justify-content:flex-end;"><div style="font-size:11px;font-weight:700;color:rgba(255,255,255,.7);margin-bottom:4px;text-transform:uppercase;letter-spacing:.06em;">${sub}</div><div style="font-size:20px;font-weight:800;color:#fff;line-height:1.2;margin-bottom:8px;">${title}</div><div style="display:inline-flex;align-items:center;gap:6px;background:var(--brand);color:#fff;font-size:12px;font-weight:700;padding:7px 16px;border-radius:20px;width:fit-content;">Ver oferta</div></div></div>`;
  }).join('');
  // dots
  dotsEl.innerHTML = bannerItems.map((_,i)=>`<div style="width:6px;height:6px;border-radius:50%;background:${i===0?'#fff':'rgba(255,255,255,.35)'};" class="bdot" data-idx="${i}"></div>`).join('');
  // attach click handlers
  dotsEl.querySelectorAll('.bdot').forEach(d=>d.addEventListener('click', ()=>{const i=Number(d.dataset.idx);moveBannerTo(i);}));
  // reset index and autoplay
  bannerIdx = 0; moveBannerTo(0);
  if(bannerAutoInterval) clearInterval(bannerAutoInterval);
  bannerAutoInterval = setInterval(()=>{ moveBannerTo((bannerIdx+1) % bannerItems.length); }, 4000);
}

function moveBannerTo(idx){ if(!bannerItems.length) return; bannerIdx = ((idx % bannerItems.length)+bannerItems.length)%bannerItems.length; const slidesEl = document.getElementById('banner-slides'); slidesEl.style.transform = `translateX(-${bannerIdx*100}%)`; document.querySelectorAll('.bdot').forEach((d,i)=>{ d.style.background = i===bannerIdx ? '#fff' : 'rgba(255,255,255,.35)'; }); }

document.getElementById('hero-banner')?.addEventListener('click', ()=> moveBannerTo((bannerIdx+1) % (bannerItems.length||1)));

// Setup Supabase Realtime subscription for patrocinios
function setupPatrociniosRealtime(){
  try{
    if(patrociniosChannel){
      console.log('[patrocinios] Realtime: already initialized');
      return;
    }
    // create channel and listen to INSERT / UPDATE / DELETE
    const ch = sb.channel('public:patrocinios');
    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'patrocinios' }, (payload) => {
      console.log('[patrocinios] Realtime: INSERT received', payload);
      cargarOfertasBanner();
    });
    ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'patrocinios' }, (payload) => {
      console.log('[patrocinios] Realtime: UPDATE received', payload);
      cargarOfertasBanner();
    });
    ch.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'patrocinios' }, (payload) => {
      console.log('[patrocinios] Realtime: DELETE received', payload);
      cargarOfertasBanner();
    });

    const sub = ch.subscribe();
    patrociniosChannel = ch;
    console.log('[patrocinios] Realtime: subscribed', sub?.status || 'ok');

    // cleanup on unload to avoid duplicated listeners in SPA navigation
    window.addEventListener('beforeunload', ()=>{
      try{ if(patrociniosChannel) sb.removeChannel(patrociniosChannel); }catch(e){}
    });
  }catch(e){ console.error('[patrocinios] Realtime: failed to init', e); }
}

const imgsCategorias={comida:'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=700&q=80',carniceria:'https://images.unsplash.com/photo-1529692236671-f1f6cf9683ba?w=700&q=80',farmacia:'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=700&q=80',supermercado:'https://images.unsplash.com/photo-1604719312566-8912e9227c6a?w=700&q=80',verduleria:'https://images.unsplash.com/photo-1518843875459-f738682238a6?w=700&q=80',panaderia:'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=700&q=80',heladeria:'https://images.unsplash.com/photo-1497034825429-c343d7c6a68f?w=700&q=80',bebidas:'https://images.unsplash.com/photo-1437418747212-8d9709afab22?w=700&q=80',mascotas:'https://images.unsplash.com/photo-1601758228041-f3b2795255f1?w=700&q=80',kiosco:'https://images.pexels.com/photos/8867645/pexels-photo-8867645.jpeg?w=700&q=80'};

async function cargarOfertasBanner(){
  try{
    // Load patrocinio banners (active) ordered by 'orden'
    const { data, error } = await sb.from('patrocinios').select('*').eq('activo', true).order('created_at',{ascending:false});
    if(error) throw error;
    const banners = data || [];
    // Render main hero banner slides
    renderBannerSlides(banners.slice(0, 10));
    // Keep ofertas-banner (small horizontal) for promociones as before
    const hoy=new Date().toISOString().split('T')[0];
    const{data:promosData} = await sb.from('promociones').select('*').eq('activa',true).gte('fecha_fin',hoy).limit(8);
    const promos = promosData||[];
    if(!promos.length){document.getElementById('ofertas-banner-wrap').style.display='none';return;}
    document.getElementById('ofertas-banner-wrap').style.display='block';
    document.getElementById('ofertas-slides').innerHTML=promos.map(p=>{
      const com=allComercios.find(c=>c.id===p.comercio_id)||{};
      const img=com.imagen_url||imgsCategorias[com.categoria]||'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=400&q=80';
      const badgeLabel=p.tipo==='envio_gratis'?'ENVÍO GRATIS':`${p.porcentaje}% OFF`;
      const descSub=p.descripcion||(p.tipo==='envio_gratis'?'En tu próximo pedido':'En todo el menú');
      const comercioNombre=com.nombre||'Comercio';
      return`<div onclick="abrirComercio('${p.comercio_id}')" style="width:155px;border-radius:14px;overflow:hidden;background:#111;flex-shrink:0;cursor:pointer;position:relative;box-shadow:0 2px 10px rgba(0,0,0,.15);"><div style="position:relative;height:90px;overflow:hidden;"><img src="${img}" alt="${comercioNombre}" style="width:100%;height:90px;object-fit:cover;display:block;filter:brightness(.45);"/><div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.7) 0%,rgba(0,0,0,0) 55%);"></div><div style="position:absolute;top:8px;left:8px;background:#FF6B35;color:#fff;font-size:8px;font-weight:800;padding:2px 8px;border-radius:20px;letter-spacing:.04em;">${badgeLabel}</div></div><div style="padding:8px 10px 10px;background:#111;"><div style="font-size:12px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${comercioNombre}</div><div style="font-size:10px;color:rgba(255,255,255,.5);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${descSub}</div></div></div>`;
    }).join('');
  }catch(e){document.getElementById('ofertas-banner-wrap').style.display='none';console.error('Error loading banners',e);}
}

detectarUbicacion();
cargarComercios();
cargarOfertasBanner();


