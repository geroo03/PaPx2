import { supabase } from './config.js';

// ----------------------------------------
// CLIENTES
// ----------------------------------------
export const clienteAPI = {
  // Obtener comercios activos
  obtenerComercios: async () => {
    const { data, error } = await supabase
      .from('comercios')
      .select('*')
      .eq('activo', true)
      .order('rating', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  // Obtener productos de un comercio
  obtenerProductosDelComercio: async (comercioId) => {
    const { data, error } = await supabase
      .from('productos')
      .select('*')
      .eq('comercio_id', comercioId)
      .eq('disponible', true);
    if (error) throw error;
    return data || [];
  },

  // Crear o guardar un pedido
  crearPedido: async (pedido) => {
    const { data, error } = await supabase
      .from('pedidos')
      .insert([pedido])
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // Realizar seguimiento (obtener por ID)
  obtenerPedidoPorId: async (pedidoId) => {
    const { data, error } = await supabase
      .from('pedidos')
      .select('*, comercios(nombre, imagen_url, categoria)')
      .eq('id', pedidoId)
      .single();
    if (error) throw error;
    return data;
  },

  // Historico de pedidos
  obtenerMisPedidos: async (userId) => {
    const { data, error } = await supabase
      .from('pedidos')
      .select('*, comercios(nombre, imagen_url)')
      .eq('usuario_id', userId)
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) throw error;
    return data || [];
  }
};

// ----------------------------------------
// COMERCIOS
// ----------------------------------------
export const comercioAPI = {
  obtenerDatosComercio: async (userId) => {
    const { data, error } = await supabase
      .from('comercios')
      .select('*')
      .eq('usuario_id', userId)
      .limit(1)
      .single();
    if (error) throw error;
    return data;
  },

  actualizarEstadoComercio: async (comercioId, abierto) => {
    const { error } = await supabase
      .from('comercios')
      .update({ abierto_ahora: abierto })
      .eq('id', comercioId);
    if (error) throw error;
  },

  obtenerPedidosActivos: async (comercioId) => {
    const { data, error } = await supabase
      .from('pedidos')
      .select('*')
      .eq('comercio_id', comercioId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    return data || [];
  },

  actualizarEstadoPedido: async (pedidoId, estadoNuevo, tipoDelivery = null) => {
    const payload = { estado: estadoNuevo };
    if (tipoDelivery) payload.tipo_delivery = tipoDelivery;
    
    const { error } = await supabase
      .from('pedidos')
      .update(payload)
      .eq('id', pedidoId);
    if (error) throw error;
  }
};

// ----------------------------------------
// CADETES
// ----------------------------------------
export const cadeteAPI = {
  obtenerViajesDisponibles: async () => {
    const { data, error } = await supabase
      .from('pedidos')
      .select('*, comercios(nombre, direccion)')
      .eq('tipo_delivery', 'app')
      .in('estado', ['preparando', 'en_camino'])
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  // ¡ACÁ PARCHAMOS LA CONCURRENCIA USANDO LA FUNCIÓN RPC CREADA!
  // Evitamos race condition de aceptar 2 a la vez
  tomarPedidoSeguro: async (pedidoId, cadeteId) => {
    const { data, error } = await supabase.rpc('tomar_pedido', {
      p_pedido_id: pedidoId,
      p_cadete_id: cadeteId
    });
    if (error) throw error;
    return data; // Retorna true si tuvo exito, false si alguien mas lo tomó
  },

  // ¡ACÁ PARCHAMOS EL FRAUDE DEL PIN!
  confirmarEntregaSegura: async (pedidoId, pin) => {
    const { data, error } = await supabase.rpc('confirmar_entrega', {
      p_pedido_id: pedidoId,
      p_pin: pin
    });
    if (error) throw error;
    return data; // Retorna true si el PIN es correcto y se actualizó
  }
};
