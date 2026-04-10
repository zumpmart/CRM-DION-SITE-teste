import { Receipt } from './types';

export interface OcrResult {
  value: number | null;
  date: string | null; // YYYY-MM-DD
  rawText: string;
}

export interface AuditResult {
  status: 'approved' | 'divergent' | 'duplicate' | 'error';
  ocrValue: number | null;
  ocrDate: string | null;
  rawText: string;
  details: string;
  imageHash: string;
}

/**
 * Generate a simple hash from base64 image data for duplicate detection
 */
export function generateImageHash(base64Data: string): string {
  // Use a portion of the base64 data to create a fingerprint
  // Skip the data:image/... prefix
  const dataStart = base64Data.indexOf(',');
  const rawData = dataStart >= 0 ? base64Data.substring(dataStart + 1) : base64Data;
  
  // Simple hash using djb2 algorithm on a sample of the data
  let hash = 5381;
  const step = Math.max(1, Math.floor(rawData.length / 2000)); // Sample ~2000 chars
  for (let i = 0; i < rawData.length; i += step) {
    hash = ((hash << 5) + hash) + rawData.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Extract value and date from a receipt image using Gemini OCR via serverless function
 */
export async function extractFromReceipt(base64Image: string): Promise<OcrResult> {
  try {
    // Extract mime type and base64 data
    const mimeMatch = base64Image.match(/^data:(.*?);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const dataStart = base64Image.indexOf(',');
    const base64Data = dataStart >= 0 ? base64Image.substring(dataStart + 1) : base64Image;

    const prompt = `Analise este comprovante de pagamento e extraia APENAS as seguintes informações. Responda SOMENTE no formato JSON abaixo, sem nenhum texto adicional:

{
  "valor": 0.00,
  "data": "YYYY-MM-DD"
}

Regras:
- "valor": o valor total do pagamento em reais (número decimal, ex: 49.90)
- "data": a data do pagamento no formato YYYY-MM-DD
- Se não conseguir identificar o valor, use null
- Se não conseguir identificar a data, use null
- Considere o valor principal da transação (não taxas ou descontos)
- Para comprovantes PIX, o valor é o "Valor" ou "Valor da transferência"`;

    const response = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64Data, mimeType, prompt }),
    });

    if (!response.ok) {
      const err = await response.json();
      return { value: null, date: null, rawText: err.error || 'Erro no servidor' };
    }

    const { text } = await response.json();

    // Parse JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        value: parsed.valor !== null && parsed.valor !== undefined ? Number(parsed.valor) : null,
        date: parsed.data || null,
        rawText: text,
      };
    }

    return { value: null, date: null, rawText: text };
  } catch (error: any) {
    console.error('Erro no OCR:', error);
    return { value: null, date: null, rawText: `Erro: ${error.message}` };
  }
}

/**
 * Run full audit on a receipt
 */
export async function auditReceipt(
  base64Image: string,
  confirmedValue: number,
  paidDate: string, // YYYY-MM-DD
  allReceipts: Receipt[]
): Promise<AuditResult> {
  const imageHash = generateImageHash(base64Image);

  // 1. Check for duplicates
  const duplicate = allReceipts.find(r => r.image_hash === imageHash);
  if (duplicate) {
    return {
      status: 'duplicate',
      ocrValue: null,
      ocrDate: null,
      rawText: '',
      details: `Comprovante duplicado! Já usado na venda ${duplicate.sale_id}`,
      imageHash,
    };
  }

  // 2. Extract via OCR
  const ocrResult = await extractFromReceipt(base64Image);

  if (ocrResult.value === null && ocrResult.date === null) {
    return {
      status: 'error',
      ocrValue: null,
      ocrDate: null,
      rawText: ocrResult.rawText,
      details: 'Não foi possível extrair dados do comprovante',
      imageHash,
    };
  }

  // 3. Compare value (exact match)
  const valueMatch = ocrResult.value !== null && ocrResult.value === confirmedValue;
  
  // 4. Compare date (exact match - same day)
  const dateMatch = ocrResult.date !== null && ocrResult.date === paidDate;

  // Build details
  const divergences: string[] = [];
  if (ocrResult.value !== null && !valueMatch) {
    divergences.push(`Valor: OCR R$ ${ocrResult.value.toFixed(2)} ≠ Confirmado R$ ${confirmedValue.toFixed(2)}`);
  }
  if (ocrResult.date !== null && !dateMatch) {
    divergences.push(`Data: OCR ${ocrResult.date} ≠ PAGO ${paidDate}`);
  }
  if (ocrResult.value === null) {
    divergences.push('Valor não identificado no comprovante');
  }
  if (ocrResult.date === null) {
    divergences.push('Data não identificada no comprovante');
  }

  const isApproved = valueMatch && dateMatch;

  return {
    status: isApproved ? 'approved' : 'divergent',
    ocrValue: ocrResult.value,
    ocrDate: ocrResult.date,
    rawText: ocrResult.rawText,
    details: isApproved ? 'Valor e data conferem ✅' : divergences.join(' | '),
    imageHash,
  };
}
