
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument, rgb, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1'

// 5. HEADERS Y CORS: Asegura que las peticiones desde el navegador (incluido iPad) no fallen.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// --- Objeto de Utilidades para el RUT Chileno ---
const Rut = {
  // 1. LIMPIEZA DE RUT: Elimina puntos, guiones y espacios.
  clean: (rut) => {
    return typeof rut === 'string' ? rut.replace(/[\.\-\s]/g, '').toLowerCase() : ''
  },

  // 2. VALIDACIÓN ROBUSTA: Usa el RUT limpio para validar con Módulo 11.
  validate: (rut) => {
    const cleanedRut = Rut.clean(rut)
    if (cleanedRut.length < 2) return false

    const body = cleanedRut.slice(0, -1)
    const dv = cleanedRut.slice(-1)

    // Valida que el cuerpo del RUT sean solo números
    if (!/^\d+$/.test(body)) return false

    return Rut.calculateDV(body) === dv
  },

  // Calcula el Dígito Verificador (Módulo 11)
  calculateDV: (rutBody) => {
    let M = 0, S = 1
    for (let T = parseInt(rutBody, 10); T; T = Math.floor(T / 10)) {
      S = (S + (T % 10) * (9 - (M++ % 6))) % 11
    }
    return S ? String(S - 1) : 'k'
  },

  // Formatea un RUT al estándar XX.XXX.XXX-X para mostrarlo en el PDF
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
  // Manejo de la petición pre-flight CORS (OPTIONS)
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
    if (userError || !user) throw new Error("Acceso no autorizado. Se requiere autenticación.")

    const payload = await req.json()
    const { employerName, employerRut, employerAddress, employeeName, employeeRut, schedule } = payload
    
    // --- 4. FLUJO DE VALIDACIÓN Y CRÉDITOS ---

    // Paso 1: Validar RUTs
    if (!Rut.validate(employerRut) || !Rut.validate(employeeRut)) {
      throw new Error("RUT inválido. Por favor, verifica que el RUT del empleador y del trabajador sean correctos.")
    }

    // Crear cliente Admin para operaciones críticas
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Paso 2: Validar créditos
    const { data: profile, error: fetchError } = await supabaseAdmin
      .from('perfiles_empresas')
      .select('creditos_disponibles')
      .eq('id', user.id)
      .single()

    if (fetchError) throw new Error(`Error al verificar créditos del usuario: ${fetchError.message}`)
    if (!profile || profile.creditos_disponibles <= 0) throw new Error("No tienes créditos suficientes para generar este documento.")

    // Paso 3: Generar el PDF
    const pdfDoc = await PDFDocument.create()
    const page = pdfDoc.addPage()
    const { width, height } = page.getSize()
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

    let y = height - 50
    const x = 50
    const lineheight = 18

    page.drawText('ANEXO DE CONTRATO DE TRABAJO - AJUSTE DE JORNADA LABORAL (LEY N°21.561)', { x, y, font: boldFont, size: 12 })
    y -= lineheight * 2
    page.drawText(`En ${employerAddress || 'ciudad no especificada'}, a ${new Date().toLocaleDateString('es-CL')}, entre:`, { x, y, font, size: 11 })
    y -= lineheight * 2
    page.drawText(`Empleador: ${employerName}`, { x, y, font: boldFont, size: 11 })
    y -= lineheight
    page.drawText(`RUT: ${Rut.format(employerRut)}`, { x, y, font, size: 11 })
    y -= lineheight
    page.drawText(`Domicilio: ${employerAddress}`, { x, y, font, size: 11 })
    y -= lineheight * 2
    page.drawText(`Trabajador: ${employeeName}`, { x, y, font: boldFont, size: 11 })
    y -= lineheight
    page.drawText(`RUT: ${Rut.format(employeeRut)}`, { x, y, font, size: 11 })
    y -= lineheight * 2
    page.drawText('Las partes acuerdan modificar la cláusula de jornada de trabajo, la cual quedará como sigue:', { x, y, font, size: 11, lineHeight: 15 })
    y -= lineheight * 1.5
    page.drawText('\"La jornada ordinaria de trabajo será de 40 horas semanales, distribuidas de la siguiente manera:', { x, y, font, size: 11, lineHeight: 15 })
    y -= lineheight * 1.5

    // 3. MAPEO DE HORARIO: Creación robusta de la tabla
    const table = {
      x: x,
      colWidths: [80, 70, 70, 80, 80, 80],
      lineHeight: 16,
      headers: ['Día', 'Entrada', 'Salida', 'Colación (min)', 'Inicio Colación', 'Fin Colación']
    }
    
    // Cabecera de la tabla
    table.headers.forEach((header, i) => {
      let currentX = table.x
      for (let j = 0; j < i; j++) { currentX += table.colWidths[j] }
      page.drawText(header, { x: currentX, y, font: boldFont, size: 9 })
    })
    y -= table.lineHeight

    // Filas de la tabla
    schedule.forEach(item => {
      const row = [
          item.day || '-',
          item.entry || '-',
          item.exit || '-',
          item.lunchDuration || '0',
          item.lunchEntry || '-',
          item.lunchExit || '-'
      ]
      row.forEach((cell, i) => {
          let currentX = table.x
          for (let j = 0; j < i; j++) { currentX += table.colWidths[j] }
          page.drawText(String(cell), { x: currentX, y, font, size: 9 })
      })
      y -= table.lineHeight
    })
    
    y -= 20

    page.drawText('Se deja constancia que el tiempo de colación no es imputable a la jornada de trabajo.', { x, y, font, size: 10 })
    y -= lineheight * 3

    page.drawText('___________________________', { x: x + 20, y, font, size: 11 })
    page.drawText('___________________________', { x: width / 2 + 20, y, font, size: 11 })
    y -= lineheight * 0.8
    page.drawText(employerName, { x: x + 20, y, font, size: 10 })
    page.drawText(employeeName, { x: width / 2 + 20, y, font, size: 10 })
    y -= lineheight * 0.7
    page.drawText('Empleador', { x: x + 20, y, font, size: 9 })
    page.drawText('Trabajador', { x: width / 2 + 20, y, font, size: 9 })

    const pdfBytes = await pdfDoc.save()

    // Paso 4: Descontar crédito (solo después de generar el PDF)
    const { error: updateError } = await supabaseAdmin
      .from('perfiles_empresas')
      .update({ creditos_disponibles: profile.creditos_disponibles - 1 })
      .eq('id', user.id)

    if (updateError) {
      // Error no crítico: el usuario recibe el PDF, pero se debe notificar
      console.error(`ERROR CRÍTICO: El PDF para el usuario ${user.id} se generó pero no se pudo descontar el crédito.`, updateError.message)
    }

    // --- Respuesta Final ---
    return new Response(pdfBytes, {
      headers: { ...corsHeaders, 'Content-Type': 'application/pdf' },
      status: 200,
    })

  } catch (error) {
    console.error("Error en la función generate-anexo: ", error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400, // Usar 400 para errores de cliente (datos inválidos, sin créditos, etc.)
    })
  }
})
