
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
    // Esta función divide el texto para que no exceda el ancho máximo.
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

    // ----- SOLUCIÓN: GESTIÓN DE CURSOR 'y' DINÁMICO -----
    let y = height - margin; // Empezar desde el margen superior

    // Título
    page.drawText('ANEXO DE CONTRATO DE TRABAJO', {
      x: margin,
      y,
      font: boldFont,
      size: 14,
    });
    y -= 40; // Espacio después del título

    // Párrafo introductorio con Word-Wrap
    const today = new Date();
    const formattedDate = `${today.getDate()} de ${today.toLocaleString('es-CL', { month: 'long' })} de ${today.getFullYear()}`;
    const introText = `En ${employerAddress}, a ${formattedDate}, entre ${employerName}, RUT ${employerRut}, representada legalmente por ${employerRepName}, RUT ${employerRepRut}, ambos con domicilio en ${employerAddress}, en adelante "el empleador"; y don(a) ${employeeName}, RUT ${employeeRut}, en adelante "el trabajador", se ha convenido el siguiente anexo al contrato de trabajo:`;

    const maxWidth = width - margin * 2; // Ancho máximo respetando márgenes
    const wrappedIntro = wrapText(introText, font, fontSize, maxWidth);

    for (const line of wrappedIntro) {
      page.drawText(line, { x: margin, y, font, size: fontSize });
      y -= (fontSize + 4); // Decrementar 'y' para la siguiente línea (interlineado normal)
    }

    y -= 25; // Espacio profesional entre párrafos

    // Párrafo de acuerdo
    const agreementText = `Las partes acuerdan modificar la cláusula de jornada de trabajo, la cual quedará establecida de la siguiente manera, en conformidad con la Ley N°21.561:`;
    const wrappedAgreement = wrapText(agreementText, font, fontSize, maxWidth);

    for (const line of wrappedAgreement) {
      page.drawText(line, { x: margin, y, font, size: fontSize });
      y -= (fontSize + 4);
    }
    
    y -= 30; // Más espacio antes de la tabla

    // Lógica para la tabla (sin cambios, pero usando 'y' dinámico)
    // ... aquí iría el código para dibujar la tabla del horario,
    // actualizando 'y' después de cada fila dibujada.
    // Por simplicidad, se omite la tabla compleja y se añade un marcador.
    
    const scheduleText = schedule.map(d => 
      `${d.day}: ${d.entry} - ${d.exit} (Colación: ${d.lunchDuration || 'N/A'} min)`
    ).join(''''\n'''');
    
    // Ejemplo de cómo dibujarías las líneas del horario
    let totalHoras = 0;
    for(const day of schedule) {
      // Simulación de cálculo de horas para el total
      if(day.entry && day.exit) {
        const [h1, m1] = day.entry.split(':').map(Number);
        const [h2, m2] = day.exit.split(':').map(Number);
        let diff = (h2 * 60 + m2) - (h1 * 60 + m1);
        if(diff < 0) diff += 24 * 60; // Cruce de medianoche
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
    

    // ... aquí iría el resto de las cláusulas y las firmas,
    // siempre usando la variable 'y' y decrementándola.
    
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
