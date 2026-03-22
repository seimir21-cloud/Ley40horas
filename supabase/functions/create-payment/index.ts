
// supabase/functions/create-payment/index.ts

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders } from './_shared/cors.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// La clave de servicio de Supabase nos da permisos de administrador para actuar en nombre del usuario.
const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SERVICE_ROLE_KEY') ?? ''
)

serve(async (req) => {
  // Manejo de la solicitud pre-vuelo (preflight) para CORS. Es un chequeo de seguridad del navegador.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Extraer el token de autenticación del usuario para identificarlo.
    const authHeader = req.headers.get('Authorization')!
    const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '', 
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Usuario no encontrado.");

    // 2. Obtener el plan deseado ("basico" o "pack_5") del cuerpo de la solicitud.
    const { plan } = await req.json()
    if (!plan || (plan !== 'basico' && plan !== 'pack_5')) {
      throw new Error("Plan inválido especificado.");
    }

    // 3. Definir los detalles del producto según el plan.
    const products = {
      basico: {
        title: 'Anexo PDF Básico',
        description: 'Generación de 1 Anexo de Contrato PDF.',
        quantity: 1,
        price: 4990,
        credits: 1,
      },
      pack_5: {
        title: 'Paquete 5 Anexos PDF',
        description: 'Paquete de 5 créditos para generar Anexos de Contrato PDF.',
        quantity: 1,
        price: 19990,
        credits: 5,
      },
    }
    const product = products[plan];

    // 4. Crear la preferencia de pago en Mercado Pago.
    // La `external_reference` es crucial: nos permite vincular el pago de MP con el usuario y el plan.
    const preference = {
      items: [
        {
          title: product.title,
          description: product.description,
          quantity: product.quantity,
          unit_price: product.price,
          currency_id: 'CLP',
        },
      ],
      payer: {
        email: user.email,
      },
      back_urls: { // URLs a las que se redirige al usuario después del pago.
        success: `${Deno.env.get('SITE_URL')}?payment=success`,
        failure: `${Deno.env.get('SITE_URL')}?payment=failure`,
        pending: `${Deno.env.get('SITE_URL')}?payment=pending`,
      },
      auto_return: 'approved', // Regresar automáticamente a `success` si el pago es aprobado.
      external_reference: `${user.id}__${plan}`, // Dato personalizado para identificar quién pagó y qué compró.
      notification_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/payment-webhook` // URL para que MP nos notifique cambios de estado.
    };

    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('MERCADOPAGO_ACCESS_TOKEN')}`,
      },
      body: JSON.stringify(preference),
    })

    if (!mpResponse.ok) {
        const errorBody = await mpResponse.json();
        console.error('Error de la API de Mercado Pago:', errorBody);
        throw new Error(`No se pudo crear la preferencia de pago: ${mpResponse.statusText}`);
    }

    const { init_point } = await mpResponse.json(); // Esta es la URL de pago que el usuario debe visitar.

    // 5. Devolver la URL de pago al frontend.
    return new Response(JSON.stringify({ payment_url: init_point }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
