import { GoogleGenAI } from '@google/genai';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'API key not configured' }, { status: 500 });
  }

  try {
    const { base64Data, mimeType, prompt } = await req.json();
    
    const genai = new GoogleGenAI({ apiKey });
    const response = await genai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType, data: base64Data } },
            { text: prompt },
          ],
        },
      ],
    });

    const text = response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return Response.json({ text });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
};

export const config = {
  path: '/api/gemini',
};
