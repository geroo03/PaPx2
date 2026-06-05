// order-service.js — Mock order storage using localStorage
(function(){
  const STORAGE_KEY = 'pap_orders';

  function readOrders(){
    try{ const raw = localStorage.getItem(STORAGE_KEY)||'[]'; return JSON.parse(raw); }catch(e){ return []; }
  }

  function writeOrders(arr){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    // emit update event
    try{ document.dispatchEvent(new CustomEvent('pap:orders-updated',{detail:{count:arr.length}})); }catch(e){}
  }

  function makeId(){
    return 'ord-' + Date.now() + '-' + Math.random().toString(36).slice(2,8);
  }

  // Estado constants
  const ESTADO_PREPARADO = 'preparado';
  const ESTADO_BUSCANDO = 'buscando';
  const ESTADO_EN_CAMINO = 'en_camino';
  const ESTADO_ENTREGADO = 'entregado';

  function createPedido({ cliente, direccion, total, notas }){
    const pedidos = readOrders();
    const id = makeId();
    // compute next sequential number
    const maxNum = pedidos.reduce((m, p) => Math.max(m, (p.numero||0)), 0);
    const numero = maxNum + 1;
    const pedido = {
      id,
      numero,
      cliente: cliente || 'Cliente',
      direccion: direccion || '',
      total: Number(total) || 0,
      notas: notas || '',
      estado: ESTADO_PREPARADO,
      creado_en: new Date().toISOString()
    };
    pedidos.unshift(pedido);
    writeOrders(pedidos);
    return pedido;
  }

  function updatePedido(id, patch){
    const pedidos = readOrders();
    const idx = pedidos.findIndex(p => p.id === id);
    if(idx === -1) return null;
    const updated = Object.assign({}, pedidos[idx], patch);
    pedidos[idx] = updated;
    writeOrders(pedidos);
    return updated;
  }

  function getPedidos(){ return readOrders(); }

  function clearPedidos(){ writeOrders([]); }

  // expose
  window.orderService = {
    ESTADO_PREPARADO,
    ESTADO_BUSCANDO,
    ESTADO_EN_CAMINO,
    ESTADO_ENTREGADO,
    createPedido,
    updatePedido,
    getPedidos,
    clearPedidos
  };
})();
