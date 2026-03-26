
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument, rgb, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1';
import { corsHeaders } from '../_shared/cors.ts';

// Interfaz para el payload esperado
interface AnexoPayload {
  employerName: string;
  employerRut: string;
  employerRepName: string;
  employerRepRut: string;
  employerAddress: string;
  employeeName: string;
  employeeRut: string;
  schedule: Array<{
    day: string;
    entry: string;
    exit: string;
    lunchDuration: string;
  }>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload: AnexoPayload = await req.json();
    const {
      employerName, employerRut, employerRepName, employerRepRut,
      employerAddress, employeeName, employeeRut, schedule
    } = payload;
    
    // Validar datos básicos
    if (!employerName || !employeeName || !schedule) {
      throw new Error("Faltan datos esenciales para generar el anexo.");
    }

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontSize = 11;
    const margin = 50;

    // ----- SOLUCIÓN: FUNCIÓN DE WORD-WRAP -----
    const wrapText = (text: string, f: typeof font, size: number, maxWidth: number): string[] => {
        const words = text.split(' ');
        let line = '';
        const lines: string[] = [];

        for (const word of words) {
            const testLine = line.length > 0 ? `${line} ${word}` : word;
            const testWidth = f.widthOfTextAtSize(testLine, size);
            if (testWidth > maxWidth) {
                lines.push(line);
                line = word;
            } else {
                line = testLine;
            }
        }
        lines.push(line);
        return lines;
    };

    // ----- GESTIÓN DE CURSOR 'y' DINÁMICO -----
    let y = height - margin;

    // Título
    page.drawText('ANEXO DE CONTRATO DE TRABAJO', {
      x: margin,
      y,
      font: boldFont,
      size: 14,
    });
    y -= 40;

    // Párrafo introductorio con Word-Wrap
    const today = new Date();
    const formattedDate = `${today.getDate()} de ${today.toLocaleString('es-CL', { month: 'long' })} de ${today.getFullYear()}`;
    const introText = `En ${employerAddress}, a ${formattedDate}, entre ${employerName}, RUT ${employerRut}, representada legalmente por ${employerRepName}, RUT ${employerRepRut}, ambos con domicilio en ${employerAddress}, en adelante "el empleador"; y don(a) ${employeeName}, RUT ${employeeRut}, en adelante "el trabajador", se ha convenido el siguiente anexo al contrato de trabajo:`;

    const maxWidth = width - margin * 2;
    const wrappedIntro = wrapText(introText, font, fontSize, maxWidth);

    for (const line of wrappedIntro) {
      page.drawText(line, { x: margin, y, font, size: fontSize });
      y -= (fontSize + 4);
    }

    y -= 25;

    // Párrafo de acuerdo
    const agreementText = `Las partes acuerdan modificar la cláusula de jornada de trabajo, la cual quedará establecida de la siguiente manera, en conformidad con la Ley N°21.561:`;
    const wrappedAgreement = wrapText(agreementText, font, fontSize, maxWidth);

    for (const line of wrappedAgreement) {
      page.drawText(line, { x: margin, y, font, size: fontSize });
      y -= (fontSize + 4);
    }
    
    y -= 30;

    // Variable no usada, pero con la sintaxis corregida para evitar el error de deploy.
    const scheduleText = schedule.map(d => 
      `${d.day}: ${d.entry} - ${d.exit} (Colación: ${d.lunchDuration || 'N/A'} min)`
    ).join('\n');
    
    // Dibujo de la tabla del horario
    let totalHoras = 0;
    for(const day of schedule) {
      if(day.entry && day.exit) {
        const [h1, m1] = day.entry.split(':').map(Number);
        const [h2, m2] = day.exit.split(':').map(Number);
        let diff = (h2 * 60 + m2) - (h1 * 60 + m1);
        if(diff < 0) diff += 24 * 60;
        diff -= (Number(day.lunchDuration) || 0);
        totalHoras += diff / 60;
      }
      const dayText = `${day.day.padEnd(10)} | Entrada: ${day.entry} | Salida: ${day.exit} | Colación: ${day.lunchDuration} min.`;
       page.drawText(dayText, { x: margin, y, font, size: fontSize });
       y -= (fontSize + 5);
    }
     y -= 15;
    page.drawText(`Total de horas semanales: ${totalHoras.toFixed(1)} horas.`, {
        x: margin,
        y,
        font: boldFont,
        size: fontSize,
    });
    
    const pdfBytes = await pdfDoc.save();

    return new Response(pdfBytes, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="anexo_contrato.pdf"',
      },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
