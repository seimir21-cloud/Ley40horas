
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

    let y = height - margin;

    page.drawText('ANEXO DE CONTRATO DE TRABAJO', {
      x: margin,
      y,
      font: boldFont,
      size: 14,
    });
    y -= 40;

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

    const agreementText = `Las partes acuerdan modificar la cláusula de jornada de trabajo, la cual quedará establecida de la siguiente manera, en conformidad con la Ley N°21.561:`;
    const wrappedAgreement = wrapText(agreementText, font, fontSize, maxWidth);

    for (const line of wrappedAgreement) {
      page.drawText(line, { x: margin, y, font, size: fontSize });
      y -= (fontSize + 4);
    }
    
    y -= 30;
    
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

    // ==================================
    // BLOQUE DE FIRMAS - POSICIÓN FIJA
    // ==================================
    const signatureY = 120;
    const signatureFontSize = 10;
    const signatureLineLength = 200;
    const signatureLineY = signatureY + 20;

    const employerSignatureX = 50;
    page.drawLine({
      start: { x: employerSignatureX, y: signatureLineY },
      end: { x: employerSignatureX + signatureLineLength, y: signatureLineY },
      thickness: 1,
      color: rgb(0, 0, 0),
    });
    page.drawText(employerName, {
      x: employerSignatureX,
      y: signatureY,
      font,
      size: signatureFontSize,
    });
    page.drawText(`p.p. ${employerRepName}`, {
      x: employerSignatureX,
      y: signatureY - (signatureFontSize + 2),
      font,
      size: signatureFontSize,
    });

    const employeeSignatureX = 350;
    page.drawLine({
      start: { x: employeeSignatureX, y: signatureLineY },
      end: { x: employeeSignatureX + signatureLineLength, y: signatureLineY },
      thickness: 1,
      color: rgb(0, 0, 0),
    });
    page.drawText(employeeName, {
      x: employeeSignatureX,
      y: signatureY,
      font,
      size: signatureFontSize,
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
