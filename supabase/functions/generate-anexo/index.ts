
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument, rgb, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Objeto de Utilidades para el RUT Chileno (ya corregido)
const Rut = {
  clean: (rut) => typeof rut === 'string' ? rut.replace(/[\.\-\s]/g, '').toLowerCase() : '',
  validate: (rut) => {
    const cleanedRut = Rut.clean(rut)
    if (cleanedRut.length < 2 || !/^\d+$/.test(cleanedRut.slice(0, -1))) return false
    return Rut.calculateDV(cleanedRut.slice(0, -1)) === cleanedRut.slice(-1)
  },
  calculateDV: (rutBody) => {
    let M = 0, S = 1
    for (let T = parseInt(rutBody, 10); T; T = Math.floor(T / 10)) {
      S = (S + (T % 10) * (9 - (M++ % 6))) % 11
    }
    return S ? String(S - 1) : 'k'
  },
  format: (rut) => {
    const cleaned = Rut.clean(rut).toUpperCase()
    if (cleaned.length < 2) return cleaned
    const body = cleaned.slice(0, -1)
    const dv = cleaned.slice(-1)
    const formattedBody = new Intl.NumberFormat('es-CL').format(parseInt(body, 10))
    return `${formattedBody}-${dv}`
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // --- Autenticación y obtención de datos ---
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) throw new Error("Acceso no autorizado.")

    const payload = await req.json()
    const { employerName, employerRut, employerAddress, employeeName, employeeRut, schedule } = payload
    
    // 3. LOGS: Imprimir el contenido del horario recibido.
    console.log("====== ANEXO PAYLOAD RECIBIDO ======");
    console.log(JSON.stringify(payload, null, 2));
    console.log("====================================");

    // --- Flujo de Validación ---
    if (!Rut.validate(employerRut) || !Rut.validate(employeeRut)) {
      throw new Error("RUT inválido. Verifica los datos del empleador y trabajador.")
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: profile, error: fetchError } = await supabaseAdmin.from('perfiles_empresas').select('creditos_disponibles').eq('id', user.id).single()
    if (fetchError || !profile || profile.creditos_disponibles <= 0) {
        throw new Error("No tienes créditos suficientes o hubo un error al verificarlos.");
    }

    // --- Generación del PDF ---
    const pdfDoc = await PDFDocument.create()
    const page = pdfDoc.addPage()
    const { width, height } = page.getSize()
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

    let y = height - 50
    const x = 50
    const lineheight = 18

    // ... (código para dibujar los datos del empleador/trabajador - sin cambios)
    page.drawText('ANEXO DE CONTRATO DE TRABAJO - AJUSTE DE JORNADA LABORAL (LEY N°21.561)', { x, y, font: boldFont, size: 12 }); y -= lineheight * 2;
    page.drawText(`En ${employerAddress || 'ciudad no especificada'}, a ${new Date().toLocaleDateString('es-CL')}, entre:`, { x, y, font, size: 11 }); y -= lineheight * 2;
    page.drawText(`Empleador: ${employerName}`, { x, y, font: boldFont, size: 11 }); y -= lineheight;
    page.drawText(`RUT: ${Rut.format(employerRut)}`, { x, y, font, size: 11 }); y -= lineheight;
    page.drawText(`Domicilio: ${employerAddress}`, { x, y, font, size: 11 }); y -= lineheight * 2;
    page.drawText(`Trabajador: ${employeeName}`, { x, y, font: boldFont, size: 11 }); y -= lineheight;
    page.drawText(`RUT: ${Rut.format(employeeRut)}`, { x, y, font, size: 11 }); y -= lineheight * 2;
    page.drawText('Las partes acuerdan modificar la cláusula de jornada de trabajo, la cual quedará como sigue:', { x, y, font, size: 11, lineHeight: 15 }); y -= lineheight * 1.5;
    page.drawText('\"La jornada ordinaria de trabajo será de 40 horas semanales, distribuidas de la siguiente manera:', { x, y, font, size: 11, lineHeight: 15 }); y -= lineheight * 1.5;

    // 2. BACKEND: Loop de la tabla a prueba de errores.
    const table = { x: x, colWidths: [80, 70, 70, 80, 80, 80], lineHeight: 16, headers: ['Día', 'Entrada', 'Salida', 'Colación (min)', 'Inicio Colación', 'Fin Colación'] }
    
    table.headers.forEach((header, i) => {
      let currentX = table.x; for (let j = 0; j < i; j++) { currentX += table.colWidths[j] } page.drawText(header, { x: currentX, y, font: boldFont, size: 9 })
    })
    y -= table.lineHeight

    if (Array.isArray(schedule) && schedule.length > 0) {
        schedule.forEach(item => {
            const row = [ item.day || '-', item.entry || '-', item.exit || '-', item.lunchDuration || '0', item.lunchEntry || '-', item.lunchExit || '-' ]
            row.forEach((cell, i) => {
                let currentX = table.x; for (let j = 0; j < i; j++) { currentX += table.colWidths[j] } page.drawText(String(cell), { x: currentX, y, font, size: 9 })
            })
            y -= table.lineHeight
        })
    } else {
        page.drawText('No se proporcionaron datos de horario para la tabla.', { x: table.x, y, font, size: 9, color: rgb(0.5, 0.5, 0.5) })
        y -= table.lineHeight
    }
    
    y -= 20

    // ... (código para dibujar firmas y descontar créditos - sin cambios)
    page.drawText('Se deja constancia que el tiempo de colación no es imputable a la jornada de trabajo.', { x, y, font, size: 10 }); y -= lineheight * 3;
    page.drawText('___________________________', { x: x + 20, y, font, size: 11 }); page.drawText('___________________________', { x: width / 2 + 20, y, font, size: 11 }); y -= lineheight * 0.8;
    page.drawText(employerName, { x: x + 20, y, font, size: 10 }); page.drawText(employeeName, { x: width / 2 + 20, y, font, size: 10 }); y -= lineheight * 0.7;
    page.drawText('Empleador', { x: x + 20, y, font, size: 9 }); page.drawText('Trabajador', { x: width / 2 + 20, y, font, size: 9 });

    const pdfBytes = await pdfDoc.save()

    const { error: updateError } = await supabaseAdmin.from('perfiles_empresas').update({ creditos_disponibles: profile.creditos_disponibles - 1 }).eq('id', user.id)
    if (updateError) {
      console.error(`ERROR CRÍTICO: PDF para ${user.id} generado, pero el crédito no fue descontado.`, updateError.message)
    }

    return new Response(pdfBytes, { headers: { ...corsHeaders, 'Content-Type': 'application/pdf' }, status: 200, })

  } catch (error) {
    console.error("Error en la función generate-anexo: ", error)
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 })
  }
})
