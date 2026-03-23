
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Las reglas de CORS son importantes para cualquier endpoint, aunque los webhooks
// son principalmente server-to-server, es una buena práctica incluirlas.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

console.log("INFO: Inicializando la Función de Webhook de Pagos.");

serve(async (req) => {
  // Responde inmediatamente a las solicitudes OPTIONS de pre-vuelo (pre-flight).
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Extraer el cuerpo de la notificación de Mercado Pago.
    // El 'data.id' contiene el ID del pago que debemos consultar.
    const notification = await req.json()
    const paymentId = notification?.data?.id;

    if (!paymentId) {
      console.warn("WARN: Webhook recibido sin un ID de pago.", notification);
      return new Response("ID de pago no encontrado en el cuerpo de la solicitud.", { status: 400 });
    }

    console.log(`INFO: Procesando notificación para el ID de pago: ${paymentId}`);

    // 2. Consultar la API de Mercado Pago para obtener el estado completo del pago.
    // Se usa el Access Token de la aplicación para autenticar la solicitud.
    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: {
        'Authorization': `Bearer ${Deno.env.get('MERCADOPAGO_ACCESS_TOKEN')}`
      }
    });

    if (!mpResponse.ok) {
      const errorText = await mpResponse.text();
      console.error(`ERROR: Fallo al consultar la API de MP para el ID ${paymentId}. Estado: ${mpResponse.status}`, errorText);
      throw new Error('No se pudo obtener la información del pago desde Mercado Pago.');
    }

    const paymentInfo = await mpResponse.json();

    // 3. Procesar el pago SOLO si el estado es 'approved'.
    if (paymentInfo.status !== 'approved') {
      console.log(`INFO: El pago ${paymentId} tiene estado '${paymentInfo.status}'. No se agregarán créditos.`);
      return new Response("Pago no aprobado. No se requiere acción.", { status: 200 });
    }
    
    console.log(`SUCCESS: El pago ${paymentId} fue aprobado.`);

    // 4. Extraer la 'external_reference' que contiene el ID de usuario y el plan.
    const externalReference = paymentInfo.external_reference;
    if (!externalReference || !externalReference.includes('__')) {
      throw new Error(`La referencia externa '${externalReference}' es inválida o no tiene el formato esperado.`);
    }
    
    const [userId, plan] = externalReference.split('__');
    const creditsToAdd = plan === 'pack_5' ? 5 : 1;

    console.log(`INFO: Asignando ${creditsToAdd} crédito(s) al usuario ${userId} por la compra del plan '${plan}'.`);

    // 5. Crear un cliente de Supabase con la SERVICE_ROLE_KEY para realizar operaciones con privilegios de administrador.
    // Esto es crucial para poder modificar la tabla 'perfiles_empresas' sin restricciones de RLS.
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 6. Actualizar los créditos del usuario de forma atómica.
    // Usamos una función RPC ('add_credits') que debería estar en tu base de datos para garantizar
    // que la suma sea atómica y segura contra "race conditions". Si no existe, este es el momento de crearla.
    // A falta de RPC, hacemos un SELECT + UPDATE, que para un webhook es generalmente seguro.

    const { data: profile, error: fetchError } = await supabaseAdmin
      .from('perfiles_empresas')
      .select('creditos_disponibles')
      .eq('id', userId)
      .single();

    if (fetchError) {
      console.error(`FATAL: No se pudo encontrar el perfil para el usuario con ID: ${userId}.`, fetchError.message);
      // Devolvemos 200 para que MP no reintente, ya que el usuario no existe.
      return new Response("Perfil de usuario no encontrado.", { status: 200 });
    }

    const newCreditCount = (profile.creditos_disponibles || 0) + creditsToAdd;

    const { error: updateError } = await supabaseAdmin
      .from('perfiles_empresas')
      .update({ creditos_disponibles: newCreditCount })
      .eq('id', userId);

    if (updateError) {
      console.error(`ERROR: Fallo al actualizar los créditos para el usuario ${userId}.`, updateError.message);
      throw new Error("No se pudieron actualizar los créditos en la base de datos.");
    }
    
    console.log(`SUCCESS: Créditos actualizados para el usuario ${userId}. Nuevo total: ${newCreditCount}.`);

    // 7. Enviar una respuesta 200 OK a Mercado Pago para confirmar que hemos procesado la notificación.
    return new Response(JSON.stringify({ success: true, message: "Créditos agregados." }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('FATAL: Error inesperado en el webhook de pago.', error.message, error.stack);
    // Si algo falla, devolvemos un 500 para que Mercado Pago reintente el envío del webhook más tarde.
    return new Response(`Error en el Webhook: ${error.message}`, { status: 500 });
  }
})
