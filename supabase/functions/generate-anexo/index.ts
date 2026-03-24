
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument, rgb, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// 2. FORMATO DE TEXTO: Función de utilidad para convertir texto a formato Título.
const toTitleCase = (text) => {
    if (!text) return ''
    return text.toLowerCase().replace(/\b(\w)/g, s => s.toUpperCase());
}

const Rut = {
  clean: (rut) => (typeof rut === 'string' ? rut.replace(/[\.\-\s]/g, '').toLowerCase() : ''),
  validate: (rut) => {
    const cleanedRut = Rut.clean(rut)
    if (cleanedRut.length < 2 || !/^\d+$/.test(cleanedRut.slice(0, -1))) return false
    return Rut.calculateDV(cleanedRut.slice(0, -1)) === cleanedRut.slice(-1)
  },
  calculateDV: (rutBody) => {
    let M = 0, S = 1
    for (let T = parseInt(rutBody, 10); T; T = Math.floor(T / 10)) { S = (S + (T % 10) * (9 - (M++ % 6))) % 11 }
    return S ? String(S - 1) : 'k'
  },
  format: (rut) => {
    const cleaned = Rut.clean(rut).toUpperCase()
    if (cleaned.length < 2) return cleaned
    const body = cleaned.slice(0, -1), dv = cleaned.slice(-1)
    const formattedBody = new Intl.NumberFormat('es-CL').format(parseInt(body, 10))
    return `${formattedBody}-${dv}`
  },
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: req.headers.get('Authorization')! } } })
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) throw new Error("Acceso no autorizado.")

    const payload = await req.json()
    let { employerName, employerRut, employerAddress, employerRepName, employerRepRut, employeeName, employeeRut, schedule } = payload
    
    // Aplicar toTitleCase a los campos de texto correspondientes
    employerName = toTitleCase(employerName)
    employerAddress = toTitleCase(employerAddress)
    employerRepName = toTitleCase(employerRepName)
    employeeName = toTitleCase(employeeName)

    if (!employerName || !employerRut || !employerAddress || !employerRepName || !employerRepRut || !employeeName || !employeeRut) {
        throw new Error("Datos incompletos. Se requieren todos los campos.")
    }
    if (!Rut.validate(employerRut) || !Rut.validate(employerRepRut) || !Rut.validate(employeeRut)) {
      throw new Error("RUT inválido. Verifica todos los RUT ingresados.")
    }

    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const { data: profile, error: fetchError } = await supabaseAdmin.from('perfiles_empresas').select('creditos_disponibles').eq('id', user.id).single()
    if (fetchError || !profile || profile.creditos_disponibles <= 0) {
        throw new Error("No tienes créditos suficientes.");
    }

    const pdfDoc = await PDFDocument.create()
    const page = pdfDoc.addPage()
    const { width, height } = page.getSize()
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
    let y = height - 50, x = 50, lineheight = 18, textWidth = width - 2 * x

    page.drawText('ANEXO DE CONTRATO DE TRABAJO', { x, y, font: boldFont, size: 14, align: 'center', width: textWidth }); y -= lineheight * 1.5;
    page.drawText('AJUSTE DE JORNADA LABORAL (LEY N°21.561)', { x, y, font: boldFont, size: 12, align: 'center', width: textWidth }); y -= lineheight * 2;

    const introText = `En ${employerAddress}, a ${new Date().toLocaleDateString('es-CL')}, entre ${employerName}, RUT ${Rut.format(employerRut)}, representada legalmente por don(ña) ${employerRepName}, RUT ${Rut.format(employerRepRut)}, ambos domiciliados en ${employerAddress}, en adelante \"el empleador\"; y por la otra parte, don(ña) ${employeeName}, RUT ${Rut.format(employeeRut)}, en adelante \"el trabajador\", se ha convenido el siguiente anexo al contrato de trabajo.`
    page.drawText(introText, { x, y, font, size: 11, lineHeight: 15, width: textWidth, align: 'justify' }); y -= lineheight * 5;

    page.drawText('Las partes acuerdan modificar la cláusula de jornada de trabajo, la cual quedará como sigue:', { x, y, font, size: 11, width: textWidth, align: 'justify' }); y -= lineheight * 1.5;
    page.drawText('"La jornada ordinaria de trabajo no excederá de 40 horas semanales, y su distribución será la siguiente:"', { x, y, font: boldFont, size: 11, width: textWidth, align: 'justify' }); y -= lineheight * 2;

    const table = { x: x, y: y, colWidths: [80, 70, 70, 70, 70, 70], lineHeight: 20, headers: ['Día', 'Entrada', 'Salida', 'Colación', 'Inicio Col.', 'Fin Col.'], borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 0.5, }
    let currentX = table.x
    table.headers.forEach((header, i) => {
        page.drawRectangle({ x: currentX, y: table.y - table.lineHeight, width: table.colWidths[i], height: table.lineHeight, borderColor: table.borderColor, borderWidth: table.borderWidth });
        page.drawText(header, { x: currentX + 5, y: table.y - 14, font: boldFont, size: 9 });
        currentX += table.colWidths[i];
    });
    y -= table.lineHeight;

    if (Array.isArray(schedule) && schedule.length > 0) {
        schedule.forEach(item => {
            const row = [ item.day || '-', item.entry || '-', item.exit || '-', item.lunchDuration || '0', item.lunchEntry || '-', item.lunchExit || '-' ];
            currentX = table.x;
            row.forEach((cell, i) => {
                page.drawRectangle({ x: currentX, y: y - table.lineHeight, width: table.colWidths[i], height: table.lineHeight, borderColor: table.borderColor, borderWidth: table.borderWidth });
                page.drawText(String(cell), { x: currentX + 5, y: y - 14, font, size: 9 });
                currentX += table.colWidths[i];
            });
            y -= table.lineHeight;
        });
    } 
    y -= lineheight * 1.5;

    page.drawText('Se deja constancia que el tiempo de colación no es imputable a la jornada de trabajo.', { x, y, font, size: 10, width: textWidth, align: 'justify' }); y -= lineheight * 1.5;
    page.drawText('En todo lo no modificado por el presente instrumento, rigen plenamente las estipulaciones del contrato de trabajo individual de fecha previamente suscrito por las partes.', { x, y, font, size: 10, lineHeight: 14, width: textWidth, align: 'justify' }); y -= lineheight * 4;

    const signatureBlockY = y, employerSignatureX = x + 50, employeeSignatureX = width / 2 + 50;
    page.drawLine({ start: { x: employerSignatureX, y: signatureBlockY }, end: { x: employerSignatureX + 150, y: signatureBlockY }, thickness: 0.8 });
    page.drawLine({ start: { x: employeeSignatureX, y: signatureBlockY }, end: { x: employeeSignatureX + 150, y: signatureBlockY }, thickness: 0.8 });
    y -= lineheight * 0.8;
    page.drawText(employerName, { x: employerSignatureX, y: y, font: boldFont, size: 10 });
    page.drawText(employeeName, { x: employeeSignatureX, y: y, font: boldFont, size: 10 }); y -= lineheight * 0.7;
    page.drawText(`p.p. ${employerRepName}`, { x: employerSignatureX, y: y, font, size: 9 });
    page.drawText('Trabajador', { x: employeeSignatureX, y: y, font, size: 9 }); y-= lineheight * 0.7;
    page.drawText(`RUT: ${Rut.format(employerRut)}`, { x: employerSignatureX, y, font, size: 9 });
    page.drawText(`RUT: ${Rut.format(employeeRut)}`, { x: employeeSignatureX, y, font, size: 9 });

    const pdfBytes = await pdfDoc.save();

    const { error: updateError } = await supabaseAdmin.from('perfiles_empresas').update({ creditos_disponibles: profile.creditos_disponibles - 1 }).eq('id', user.id)
    if (updateError) console.error(`ERROR CRÍTICO: PDF ${user.id} generado, crédito no descontado.`, updateError.message)

    return new Response(pdfBytes, { headers: { ...corsHeaders, 'Content-Type': 'application/pdf' }, status: 200 })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 })
  }
})
