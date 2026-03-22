import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Reglas de CORS integradas
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')!
    const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '', 
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Usuario no encontrado.");

    const { plan } = await req.json()
    if (!plan || (plan !== 'basico' && plan !== 'pack_5')) {
      throw new Error("Plan inválido especificado.");
    }

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
      payer: { email: user.email },
      back_urls: { 
        success: `${Deno.env.get('SITE_URL')}?payment=success`,
        failure: `${Deno.env.get('SITE_URL')}?payment=failure`,
        pending: `${Deno.env.get('SITE_URL')}?payment=pending`,
      },
      auto_return: 'approved',
      external_reference: `${user.id}__${plan}`,
      notification_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/payment-webhook`
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
        console.error('Error MP:', errorBody);
        throw new Error(`Error Mercado Pago: ${mpResponse.statusText}`);
    }

    const { init_point } = await mpResponse.json(); 

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