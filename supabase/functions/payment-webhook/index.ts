
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

console.log("INFO: Inicializando la Función de Webhook de Pagos (v2 - Robusta).");

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url);
    const notification = await req.json().catch(() => ({})); // Evita error si no hay body

    console.log("INFO: Webhook invocado.", { url: req.url, method: req.method, body: notification });

    const topic = notification?.topic || url.searchParams.get('topic');
    let paymentId = null;

    if (topic === 'payment' || topic === 'merchant_order') {
        if(notification?.data?.id){
            paymentId = notification.data.id;
            console.log(`INFO: ID de pago extraído del cuerpo JSON (Webhook): ${paymentId}`);
        } else if (url.searchParams.get('id')) {
            paymentId = url.searchParams.get('id');
            console.log(`INFO: ID de pago extraído de los parámetros URL (IPN): ${paymentId}`);
        }
    } else {
        console.log(`INFO: Tópico de notificación no relevante ('${topic}'). Ignorando.`);
    }

    if (!paymentId) {
      console.warn("WARN: No se pudo encontrar un ID de pago válido en la notificación.");
      return new Response(JSON.stringify({ success: false, message: "ID de pago no procesable." }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`INFO: Consultando API de Mercado Pago para el ID: ${paymentId}`);
    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: {
        'Authorization': `Bearer ${Deno.env.get('MERCADOPAGO_ACCESS_TOKEN')}`
      }
    });

    const paymentInfo = await mpResponse.json();
    console.log("INFO: Respuesta de la API de Mercado Pago:", paymentInfo);

    if (!mpResponse.ok) {
      throw new Error(`Fallo al consultar la API de MP. Estado: ${mpResponse.status}. Body: ${JSON.stringify(paymentInfo)}`);
    }

    if (paymentInfo.status !== 'approved') {
      console.log(`INFO: El pago ${paymentId} tiene estado '${paymentInfo.status}'. No se agregarán créditos.`);
      return new Response(JSON.stringify({ success: true, message: "Pago no aprobado. No se requiere acción." }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
    }
    
    console.log(`SUCCESS: El pago ${paymentId} fue aprobado.`);

    const externalReference = paymentInfo.external_reference;
    if (!externalReference || !externalReference.includes('__')) {
      throw new Error(`La referencia externa '${externalReference}' es inválida.`);
    }
    
    const [userId, plan] = externalReference.split('__');
    const creditsToAdd = plan === 'pack_5' ? 5 : 1;

    console.log(`INFO: Asignando ${creditsToAdd} crédito(s) al usuario ${userId} por la compra del plan '${plan}'.`);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // BARRERA DE SEGURIDAD 1 (IDEMPOTENCIA): Verificar si esta transacción ya fue pagada y procesada
    const { data: existingTx } = await supabaseAdmin
        .from('transacciones_pagos')
        .select('id')
        .eq('id_pago_pasarela', paymentId)
        .single();
        
    if (existingTx) {
       console.log(`INFO: El pago ${paymentId} YA FUE PROCESADO con anterioridad. Ignorando para evitar duplicidad de créditos.`);
       return new Response(JSON.stringify({ success: true, message: "Pago ya procesado anteriormente. Ok." }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
    }

    const { data: profile, error: fetchError } = await supabaseAdmin
      .from('perfiles_empresas')
      .select('creditos_disponibles')
      .eq('id', userId)
      .single();

    if (fetchError) {
      throw new Error(`No se pudo encontrar el perfil para el usuario con ID: ${userId}. Error: ${fetchError.message}`);
    }

    const newCreditCount = (profile.creditos_disponibles || 0) + creditsToAdd;

    const { error: updateError } = await supabaseAdmin
      .from('perfiles_empresas')
      .update({ creditos_disponibles: newCreditCount })
      .eq('id', userId);

    if (updateError) {
      throw new Error(`Fallo al actualizar los créditos para el usuario ${userId}. Error: ${updateError.message}`);
    }
    
    // REGISTRO DE SEGURIDAD 2: Guardar en el historial que ya procesamos este ID de Mercado Pago
    const { error: insertTxError } = await supabaseAdmin
        .from('transacciones_pagos')
        .insert({
            empresa_id: userId,
            id_pago_pasarela: paymentId.toString(),
            plan_comprado: plan,
            monto: paymentInfo.transaction_amount || 0,
            estado: 'aprobado'
        });

    if (insertTxError) {
        console.error(`ERROR CRÍTICO SECUNDARIO: Créditos entregados, pero falló el registro en transacciones_pagos para ${paymentId}:`, insertTxError);
    }

    console.log(`SUCCESS: Créditos actualizados para el usuario ${userId}. Nuevo total: ${newCreditCount}.`);

    return new Response(JSON.stringify({ success: true, message: "Créditos agregados." }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('FATAL: Error en el webhook de pago. Se responderá 200 para evitar reintentos.', error.message);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200, 
    });
  }
})
