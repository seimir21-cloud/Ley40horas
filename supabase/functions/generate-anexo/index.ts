
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
  contactEmail?: string;
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
    let {
      employerName, employerRut, employerRepName, employerRepRut,
      employerAddress, employeeName, employeeRut, contactEmail, schedule
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
    const introText = `En ${employerAddress.trim()}, a ${formattedDate}, entre ${employerName.toUpperCase()}, RUT ${employerRut.toUpperCase()}, representada legalmente por ${employerRepName.toUpperCase()}, RUT ${employerRepRut.toUpperCase()}, ambos con domicilio en ${employerAddress.trim()}, en adelante "el empleador"; y don(a) ${employeeName.toUpperCase()}, RUT ${employeeRut.toUpperCase()}, en adelante "el trabajador", se ha convenido el siguiente anexo al contrato de trabajo:`;

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

    // INSERCIÓN DE CLÁUSULA DE CIERRE
    y -= 40; 
    const closingText = "En comprobante de lo acordado, y en señal de aceptación, las partes ratifican y firman el presente anexo.";
    const wrappedClosing = wrapText(closingText, font, fontSize, maxWidth);
    for (const line of wrappedClosing) {
      page.drawText(line, { x: margin, y, font, size: fontSize });
      y -= (fontSize + 4);
    }

    // ===============================================
    // BLOQUE DE FIRMAS PROFESIONAL - POSICIÓN FIJA
    // ===============================================
    const Y_BASE = 120;
    const signatureFontSize = 10;
    const lineLength = 200;
    const lineY = Y_BASE + 20;
    const lineThickness = 1;
    const lineColor = rgb(0, 0, 0);

    // --- COLUMNA IZQUIERDA (EMPLEADOR) ---
    const employerX = 50;
    page.drawLine({
        start: { x: employerX, y: lineY },
        end: { x: employerX + lineLength, y: lineY },
        thickness: lineThickness,
        color: lineColor,
    });
    page.drawText(`Empleador: ${employerName.toUpperCase()}`, {
        x: employerX,
        y: Y_BASE - 15,
        font,
        size: signatureFontSize,
    });
    page.drawText(`Representante: ${employerRepName.toUpperCase()}`, {
        x: employerX,
        y: Y_BASE - 30,
        font,
        size: signatureFontSize,
    });
    page.drawText(`RUT: ${employerRepRut.toUpperCase()}`, {
        x: employerX,
        y: Y_BASE - 45,
        font,
        size: signatureFontSize,
    });

    // --- COLUMNA DERECHA (TRABAJADOR) ---
    const employeeX = 350;
    page.drawLine({
        start: { x: employeeX, y: lineY },
        end: { x: employeeX + lineLength, y: lineY },
        thickness: lineThickness,
        color: lineColor,
    });
    page.drawText(`${employeeName.toUpperCase()}`, {
        x: employeeX,
        y: Y_BASE - 15,
        font,
        size: signatureFontSize,
    });
    page.drawText(`RUT: ${employeeRut.toUpperCase()}`, {
        x: employeeX,
        y: Y_BASE - 30,
        font,
        size: signatureFontSize,
    });

    // INSERCIÓN DE CÓDIGO PARA DUPLICAR PÁGINA
    const [copiedPage] = await pdfDoc.copyPages(pdfDoc, [0]);
    pdfDoc.addPage(copiedPage);
    
    const pdfBytes = await pdfDoc.save();

    // Helper para convertir el PDF a Base64 de forma segura
    const arrayBufferToBase64 = (buffer: Uint8Array) => {
        let binary = '';
        for (let i = 0; i < buffer.byteLength; i++) {
            binary += String.fromCharCode(buffer[i]);
        }
        return btoa(binary);
    };

    // ENVÍO DE CORREO DE RESPALDO VÍA RESEND (Opcional si existe la API KEY)
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (resendApiKey && contactEmail) {
        try {
            const base64Pdf = arrayBufferToBase64(pdfBytes);
            console.log(`Enviando email de respaldo a: ${contactEmail}`);
            
            const resendReq = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${resendApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    from: 'Portal 40 Horas <anexos@portal40horas.cl>', // NOTA: Este dominio debe estar verificado en Resend
                    to: [contactEmail],
                    subject: 'Tu Anexo de Contrato Oficial - Portal 40 Horas',
                    html: `
                        <h2>¡Aquí tienes tu anexo!</h2>
                        <p>Hola,</p>
                        <p>Adjuntamos el anexo de contrato que acabas de generar en <strong>Portal 40 Horas</strong>. Te lo enviamos por este medio para que quede como respaldo seguro en tus archivos.</p>
                        <p>Si encuentras algún problema, por favor responde a este correo.</p>
                        <br>
                        <p>Atentamente,</p>
                        <p>El equipo de Portal 40 Horas</p>
                    `,
                    attachments: [
                        {
                            filename: 'Anexo_Ley_40_Horas.pdf',
                            content: base64Pdf
                        }
                    ]
                })
            });

            if (!resendReq.ok) {
                console.error("Resend Error:", await resendReq.text());
            } else {
                console.log("Email enviado exitosamente vía Resend.");
            }
        } catch (emailErr) {
            console.error("Excepción al intentar enviar correo:", emailErr);
        }
    }

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
