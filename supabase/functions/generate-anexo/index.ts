
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument, rgb, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// --- UTILIDADES DE VALIDACIÓN Y FORMATO DE RUT CHILENO ---
const Rut = {
  validate: (rut) => {
    if (!/^[0-9]+-[0-9kK]{1}$/.test(rut)) return false;
    const tmp = rut.split('-');
    let digv = tmp[1];
    const rutBody = tmp[0];
    if (digv == 'K') digv = 'k';
    return Rut.dv(rutBody) == digv;
  },
  dv: (T) => {
    let M = 0, S = 1;
    for (; T; T = Math.floor(T / 10)) {
      S = (S + T % 10 * (9 - M++ % 6)) % 11;
    }
    return S ? S - 1 : 'k';
  },
  format: (rut) => {
    rut = rut.replace(/[^0-9kK]/g, '');
    if (rut.length <= 1) return rut;
    const body = rut.slice(0, -1);
    const dv = rut.slice(-1).toUpperCase();
    const formattedBody = new Intl.NumberFormat('es-CL').format(body);
    return `${formattedBody}-${dv}`;
  },
  clean: (rut) => rut.replace(/[^0-9kK]/g, '').toLowerCase()
};


serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) throw new Error("Acceso no autorizado. Se requiere autenticación.");

    const payload = await req.json();
    const { employerName, employerRut, employerAddress, employeeName, employeeRut, schedule } = payload;
    
    // 1. VALIDACIÓN DE DATOS DE ENTRADA (INCLUYENDO RUT)
    if (!employerName || !employerRut || !employeeName || !employeeRut || !schedule) {
        throw new Error("Datos incompletos. Se requiere información del empleador, trabajador y el horario.");
    }
    if (!Rut.validate(Rut.clean(employerRut)) || !Rut.validate(Rut.clean(employeeRut))) {
        throw new Error("RUT inválido. Por favor, verifica el RUT del empleador y del trabajador.");
    }

    const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: profile, error: fetchError } = await supabaseAdmin
      .from('perfiles_empresas').select('creditos_disponibles').eq('id', user.id).single();

    if (fetchError) throw new Error(`Error al verificar créditos: ${fetchError.message}`);
    if (!profile || profile.creditos_disponibles <= 0) throw new Error("No tienes créditos suficientes.");

    // 2. GENERACIÓN DEL PDF CON TABLA MEJORADA
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let y = height - 50;
    const x = 50;
    const lineheight = 18;

    page.drawText('ANEXO DE CONTRATO DE TRABAJO - AJUSTE DE JORNADA LABORAL (LEY N°21.561)', { x, y, font: boldFont, size: 12 });
    y -= lineheight * 2;
    page.drawText(`En ${employerAddress}, a ${new Date().toLocaleDateString('es-CL')}, entre:`, { x, y, font, size: 11 });
    y -= lineheight * 2;
    page.drawText(`Empleador: ${employerName}`, { x, y, font: boldFont, size: 11 });
    y -= lineheight; page.drawText(`RUT: ${Rut.format(employerRut)}`, { x, y, font, size: 11 });
    y -= lineheight; page.drawText(`Domicilio: ${employerAddress}`, { x, y, font, size: 11 });
    y -= lineheight * 2;
    page.drawText(`Trabajador: ${employeeName}`, { x, y, font: boldFont, size: 11 });
    y -= lineheight; page.drawText(`RUT: ${Rut.format(employeeRut)}`, { x, y, font, size: 11 });
    y -= lineheight * 2;
    page.drawText('Las partes acuerdan modificar la cláusula de jornada de trabajo, la cual quedará como sigue:', { x, y, font, size: 11, lineHeight: 15 });
    y -= lineheight * 1.5;
    page.drawText('"La jornada ordinaria de trabajo será de 40 horas semanales, distribuidas de la siguiente manera:', { x, y, font, size: 11, lineHeight: 15 });
    y -= lineheight * 1.5;

    // Definición de la tabla
    const table = {
      x: x,
      y: y,
      colWidths: [80, 70, 70, 80, 80, 80],
      lineHeight: 16,
      headers: ['Día', 'Entrada', 'Salida', 'Colación (min)', 'Inicio Colación', 'Fin Colación']
    };
    
    // Dibuja la cabecera de la tabla
    table.headers.forEach((header, i) => {
      page.drawText(header, { x: table.x + table.colWidths.slice(0, i).reduce((a, b) => a + b, 0), y: table.y, font: boldFont, size: 9 });
    });
    y -= table.lineHeight;

    // Dibuja el cuerpo de la tabla (mapeo correcto de claves)
    schedule.forEach(item => {
        if(!item) return;
        const row = [item.day, item.entry, item.exit, item.lunchDuration, item.lunchEntry, item.lunchExit];
        row.forEach((cell, i) => {
            page.drawText(cell, { x: table.x + table.colWidths.slice(0, i).reduce((a, b) => a + b, 0), y: y, font, size: 9 });
        });
        y -= table.lineHeight;
    });
    
    y -= 20;

    page.drawText('Se deja constancia que el tiempo de colación no es imputable a la jornada de trabajo.', { x, y, font, size: 10 });
    y -= lineheight * 3;

    page.drawText('___________________________', { x: x + 20, y, font, size: 11 });
    page.drawText('___________________________', { x: width / 2 + 20, y, font, size: 11 });
    y -= lineheight * 0.8; page.drawText(employerName, { x: x + 20, y, font, size: 10 });
    page.drawText(employeeName, { x: width / 2 + 20, y, font, size: 10 });
    y -= lineheight * 0.7; page.drawText('Empleador', { x: x + 20, y, font, size: 9 });
    page.drawText('Trabajador', { x: width / 2 + 20, y, font, size: 9 });

    const pdfBytes = await pdfDoc.save();

    // 3. DESCONTAR CRÉDITO
    const { error: updateError } = await supabaseAdmin.from('perfiles_empresas').update({ creditos_disponibles: profile.creditos_disponibles - 1 }).eq('id', user.id);
    if (updateError) console.error(`ERROR CRÍTICO: PDF generado para ${user.id} pero el crédito no fue descontado.`);

    return new Response(pdfBytes, { headers: { ...corsHeaders, 'Content-Type': 'application/pdf' }, status: 200 });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
})
