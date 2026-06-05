import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const topic = url.searchParams.get("topic") || url.searchParams.get("type");
    const id = url.searchParams.get("data.id");

    if (topic === "payment" && id) {
      console.log(`[Webhook] Recibido evento payment con ID: ${id}`);
      
      // 1. Validar el pago con la API interna de MP (Seguridad: no confíamos en el frontend)
      const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
        headers: { Authorization: `Bearer ${Deno.env.get('MP_ACCESS_TOKEN')}` }
      });
      
      if (!mpResponse.ok) {
        throw new Error(`Error en API MP: ${mpResponse.status}`);
      }

      const mpData = await mpResponse.json();

      if (mpData.status === "approved") {
        const pedidoId = mpData.external_reference;
        console.log(`[Webhook] Pago Aprobado. Pedido Relacionado: ${pedidoId}`);
        
        // 2. Instanciar Supabase ignorando RLS para actualizar internamente
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        const { error } = await supabase
          .from('pedidos')
          .update({ estado: 'pagado' })
          .eq('id', pedidoId);

        if (error) throw error;
        console.log(`[Webhook] Estado del pedido actualizado a pagado.`);
      }
    }

    return new Response("Webhook procesado", { headers: corsHeaders, status: 200 });

  } catch (error) {
    console.error('[Error Webhook]:', error.message);
    return new Response(JSON.stringify({ error: error.message }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
      status: 400 
    });
  }
});
