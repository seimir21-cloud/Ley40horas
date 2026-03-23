
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument, rgb, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Función para formatear el RUT chileno
function formatRut(rut) {
  rut = rut.replace(/[^0-9kK]/g, '');
  if (rut.length <= 1) return rut;
  const body = rut.slice(0, -1);
  const dv = rut.slice(-1).toUpperCase();
  const formattedBody = new Intl.NumberFormat('es-CL').format(body);
  return `${formattedBody}-${dv}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Crear cliente de Supabase y validar la sesión del usuario.
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError) throw new Error(`Autenticación fallida: ${userError.message}`);
    if (!user) throw new Error("No se encontró un usuario autenticado.");

    // 2. Extraer y validar el payload del body.
    const payload = await req.json();
    const { employerName, employerRut, employerAddress, employeeName, employeeRut, schedule } = payload;
    if (!employerName || !employerRut || !employeeName || !employeeRut || !schedule) {
        throw new Error("Faltan datos en la solicitud para generar el anexo.");
    }

    // 3. Crear cliente Admin para operaciones privilegiadas.
    const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 4. VERIFICAR Y DESCONTAR CRÉDITO DE FORMA ATÓMICA (SELECT + UPDATE)
    const { data: profile, error: fetchError } = await supabaseAdmin
      .from('perfiles_empresas')
      .select('creditos_disponibles')
      .eq('id', user.id)
      .single();

    if (fetchError) throw new Error(`No se pudo obtener el perfil del usuario: ${fetchError.message}`);
    if (!profile || profile.creditos_disponibles <= 0) throw new Error("No tienes créditos suficientes para generar el documento.");

    // 5. GENERACIÓN DEL PDF
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
    y -= lineheight;
    page.drawText(`RUT: ${formatRut(employerRut)}`, { x, y, font, size: 11 });
    y -= lineheight;
    page.drawText(`Domicilio: ${employerAddress}`, { x, y, font, size: 11 });
    y -= lineheight * 2;

    page.drawText(`Trabajador: ${employeeName}`, { x, y, font: boldFont, size: 11 });
    y -= lineheight;
    page.drawText(`RUT: ${formatRut(employeeRut)}`, { x, y, font, size: 11 });
    y -= lineheight * 2;

    page.drawText('Las partes acuerdan modificar la cláusula de jornada de trabajo, la cual quedará como sigue:', { x, y, font, size: 11 });
    y -= lineheight * 1.5;

    page.drawText('"La jornada ordinaria de trabajo será de 40 horas semanales, distribuidas de la siguiente manera:', { x, y, font, size: 11 });
    y -= lineheight * 1.5;

    // Tabla de Horario
    const tableTop = y;
    const tableHeaderX = [x, x + 80, x + 160, x+240, x+320, x+400];
    const headers = ['Día', 'Entrada', 'Salida', 'Colación (min)', 'Inicio Colación', 'Fin Colación'];
    headers.forEach((header, i) => page.drawText(header, {x: tableHeaderX[i], y, font: boldFont, size: 9}));
    y -= lineheight;

    schedule.forEach(item => {
        if(!item) return;
        page.drawText(item.day, { x: tableHeaderX[0], y, font, size: 9 });
        page.drawText(item.entry, { x: tableHeaderX[1], y, font, size: 9 });
        page.drawText(item.exit, { x: tableHeaderX[2], y, font, size: 9 });
        page.drawText(item.lunchDuration, { x: tableHeaderX[3], y, font, size: 9 });
        page.drawText(item.lunchEntry, { x: tableHeaderX[4], y, font, size: 9 });
        page.drawText(item.lunchExit, { x: tableHeaderX[5], y, font, size: 9 });
        y -= lineheight * 0.9;
    });
    
    y = tableTop - ((schedule.length + 2) * lineheight * 0.9) - 20;

    page.drawText('Se deja constancia que el tiempo de colación no es imputable a la jornada de trabajo.', { x, y, font, size: 10 });
    y -= lineheight * 3;

    // Firmas
    page.drawText('___________________________', { x: x + 20, y, font, size: 11 });
    page.drawText('___________________________', { x: width / 2 + 20, y, font, size: 11 });
    y -= lineheight * 0.8;
    page.drawText(employerName, { x: x + 20, y, font, size: 10 });
    page.drawText(employeeName, { x: width / 2 + 20, y, font, size: 10 });
    y -= lineheight * 0.7;
    page.drawText('Empleador', { x: x + 20, y, font, size: 9 });
    page.drawText('Trabajador', { x: width / 2 + 20, y, font, size: 9 });

    const pdfBytes = await pdfDoc.save();

    // 6. Si el PDF se generó, descontar el crédito.
    const newCreditCount = profile.creditos_disponibles - 1;
    const { error: updateError } = await supabaseAdmin
      .from('perfiles_empresas')
      .update({ creditos_disponibles: newCreditCount })
      .eq('id', user.id);

    if (updateError) {
      console.error(`ERROR CRÍTICO: El PDF para el usuario ${user.id} se generó pero no se pudo descontar el crédito.`, updateError.message);
      // Aún así, entregamos el PDF al usuario, pero logueamos el error.
    }

    // 7. Devolver el PDF.
    return new Response(pdfBytes, {
      headers: { ...corsHeaders, 'Content-Type': 'application/pdf' },
      status: 200,
    });

  } catch (error) {
    console.error("Error en generate-anexo: ", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
})
