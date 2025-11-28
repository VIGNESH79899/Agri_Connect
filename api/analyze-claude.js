// api/analyze-claude.js
import formidable from 'formidable';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const config = {
  api: {
    bodyParser: false,
  },
};

// Split logic into small helpers to reduce cognitive complexity
async function parseForm(req) {
  const form = formidable({ // NOSONAR
    multiples: false,
    uploadDir: os.tmpdir(),
    keepExtensions: true,
    // hint for static analyzers
    allowedFileExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
    filter: (part) => {
      const name = part?.originalFilename ?? part?.filename ?? '';
      const ext = name ? path.extname(name).toLowerCase() : '';
      const allowedMime = part?.mimetype?.startsWith?.('image/');
      return Boolean(allowedMime && ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext));
    },
  });

  return await new Promise((resolve, reject) => {
    form.once('error', (err) => reject(err));
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

function readAndValidateImage(img, allowedExts = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])) {
  const imgPath = img?.filepath ?? img?.filePath ?? img?.path ?? img?._writeStream?.path;
  if (!imgPath || !fs.existsSync(imgPath)) {
    throw new Error('Uploaded image file not found on server.');
  }

  const ext = imgPath ? path.extname(imgPath).toLowerCase() : '';
  if (!allowedExts.has(ext)) {
    try { fs.unlinkSync(imgPath); } catch (err_) { console.error('failed to unlink disallowed file', err_); }
    throw new Error('Uploaded file type not allowed.');
  }

  const buf = fs.readFileSync(imgPath);
  try { fs.unlinkSync(imgPath); } catch (err_) { console.error('failed to unlink temp file', err_); }
  return { buffer: buf, mime: img.mimetype || img.type || 'image/jpeg' };
}

async function callClaude(base64, mime) {
  const payload = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
          { type: 'text', text: `You are an expert agricultural advisor. Analyze this crop image and provide:\n\n1. Crop Identification: What crop is this (if identifiable)?\n2. Health Assessment: Is the crop healthy or showing signs of disease/stress?\n3. Issues Detected: Any visible problems (diseases, pests, nutrient deficiencies, water stress)?\n4. Recommendations: Specific actions the farmer should take.\n5. Severity: Rate the urgency (Low/Medium/High).\n\nPlease be specific and practical. Format your response clearly with these sections.` },
        ],
      },
    ],
  };

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CLAUDE_API_KEY },
    body: JSON.stringify(payload),
  });
  const json = await resp.json().catch(() => ({}));
  return json;
}

function extractAnalysisText(json) {
  if (!json) return '';
  if (json.completion && typeof json.completion === 'string') return json.completion;
  if (json.message?.content && Array.isArray(json.message.content)) {
    return json.message.content.map(c => (typeof c === 'string' ? c : c?.text || '')).filter(Boolean).join('\n\n');
  }
  if (json.content && Array.isArray(json.content)) {
    return json.content.map(c => c?.text || '').filter(Boolean).join('\n\n');
  }
  return '';
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const ALLOWED_UPLOAD_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

    const { files } = await parseForm(req);
    if (!files?.image) return res.status(400).json({ error: 'Image not uploaded' });

    const img = files.image;
    const { buffer, mime } = readAndValidateImage(img, ALLOWED_UPLOAD_EXTS);
    const base64 = buffer.toString('base64');

    // Allow either CLAUDE_API_KEY (Anthropic) OR GEMINI_API_KEY + GEMINI_API_URL (Google Gemini-like)
    const hasClaude = Boolean(process.env.CLAUDE_API_KEY);
    const hasGemini = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_URL);
    if (!hasClaude && !hasGemini) {
      return res.status(500).json({ error: 'Server misconfiguration: no model API key provided. Set CLAUDE_API_KEY or (GEMINI_API_KEY + GEMINI_API_URL).' });
    }

    const json = hasGemini ? await callGemini(base64, mime) : await callClaude(base64, mime);
    let analysisText = extractAnalysisText(json);
    if (!analysisText) analysisText = 'No analysis returned from model.';

    return res.status(200).json({ analysis: analysisText, raw: json });
  } catch (error) {
    console.error('analyze-claude error:', error);
    return res.status(500).json({ error: 'Server error while analyzing image.', details: error?.message });
  }
}

// Generic Gemini caller: uses GEMINI_API_URL and GEMINI_API_KEY environment vars.
// This function is intentionally generic — update the request body if you have a
// specific Gemini/Generative API schema. We do not hard-code any API key here.
async function callGemini(base64, mime) {
  const url = process.env.GEMINI_API_URL;
  const key = process.env.GEMINI_API_KEY;
  if (!url || !key) throw new Error('GEMINI_API_URL and GEMINI_API_KEY must be set to call Gemini.');

  // Build a minimal, generic request. If your Gemini endpoint requires a different
  // payload shape, replace this body with the provider's required schema.
  const body = {
    prompt: `You are an expert agricultural advisor. Analyze the provided crop image (base64).\n\nProvide: Crop Identification, Health Assessment, Issues Detected, Recommendations, Severity (Low/Medium/High).`,
    image: { media_type: mime, data: base64 },
    // optional: allow model selection via env
    model: process.env.GEMINI_MODEL || 'gemini-large'
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify(body),
  });

  const json = await resp.json().catch(() => ({}));
  return json;
}
