// Camera barcode scanning (native BarcodeDetector, ZXing fallback) and
// nutrition-label reading (Claude vision or on-device Tesseract OCR).
import { local } from './db.js';

const ZXING = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const loaded = {};
const loadScript = src => (loaded[src] ??= new Promise((res, rej) => {
  const s = document.createElement('script');
  s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src));
  document.head.append(s);
}));

// Streams the rear camera into `video` until a barcode is read. Returns { stop, done }.
export async function scanBarcode(video) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
  video.srcObject = stream;
  await video.play();
  let stopped = false, zx;
  const stop = () => { stopped = true; stream.getTracks().forEach(t => t.stop()); zx?.reset(); };
  const done = new Promise(async (resolve, reject) => {
    try {
      const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
      if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats()).includes('ean_13')) {
        const det = new BarcodeDetector({ formats });
        while (!stopped) {
          const codes = await det.detect(video).catch(() => []);
          if (codes[0]) { stop(); return resolve(codes[0].rawValue); }
          await new Promise(r => setTimeout(r, 120));
        }
      } else {
        await loadScript(ZXING);
        zx = new ZXing.BrowserMultiFormatReader();
        zx.decodeFromVideoElementContinuously(video, (res) => { if (res && !stopped) { stop(); resolve(res.getText()); } });
      }
    } catch (e) { stop(); reject(e); }
  });
  return { stop, done };
}

// Shrinks a photo so the upload stays small (and cheap for Claude).
export async function toJpeg(file, max = 1568) {
  const img = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return { canvas: c, b64: c.toDataURL('image/jpeg', 0.85).split(',')[1] };
}

const LABEL_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['name', 'brand', 'serving_label', 'serving_g', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g', 'sodium_mg', 'notes'],
  properties: {
    name: { type: 'string' }, brand: { type: 'string' },
    serving_label: { type: 'string', description: 'Serving size as printed, e.g. "1 pita (57g)"' },
    serving_g: { type: ['number', 'null'], description: 'Serving size in grams (or ml), null if not printed' },
    kcal: { type: ['number', 'null'] }, protein_g: { type: ['number', 'null'] }, carbs_g: { type: ['number', 'null'] },
    fat_g: { type: ['number', 'null'] }, fiber_g: { type: ['number', 'null'] }, sugar_g: { type: ['number', 'null'] },
    sodium_mg: { type: ['number', 'null'] },
    notes: { type: 'string', description: 'Anything unreadable or ambiguous; empty if none' },
  },
};

// Optional: Claude API reads the label. This is billed separately from a Claude Pro plan,
// so it only runs if you add your own API key and pick it; the default is free OCR.
export async function readLabelClaude(b64) {
  const key = local.get('anthropicKey', '');
  if (!key) throw new Error('The Claude API reader needs a paid Anthropic API key (separate from Pro). Use OCR, or send the photo to Claude in chat instead.');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2026-10-21',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: local.get('claudeModel', 'claude-opus-5-5'),
      max_tokens: 4000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: LABEL_SCHEMA } },
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
        { type: 'text', text: 'Read this nutrition facts label (or package). Report values PER SERVING exactly as printed; use the "as packaged" column if there are two. If a product name or brand is visible, include it; otherwise use empty strings.' },
      ] }],
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || `Claude API ${r.status}`);
  if (d.stop_reason === 'refusal') throw new Error('Claude declined to read this image.');
  const text = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  return {
    name: j.name, brand: j.brand, servingLabel: j.serving_label, servingG: j.serving_g, notes: j.notes,
    n: { kcal: j.kcal, p: j.protein_g, c: j.carbs_g, f: j.fat_g, fib: j.fiber_g, sug: j.sugar_g, na: j.sodium_mg },
  };
}

// Free fallback: Tesseract OCR + regex over the standard US label layout.
export async function readLabelOCR(canvas, onProgress) {
  await loadScript(TESS);
  const { data } = await Tesseract.recognize(canvas, 'eng', { logger: m => m.status === 'recognizing text' && onProgress?.(m.progress) });
  return parseLabelText(data.text);
}

export function parseLabelText(raw) {
  const t = raw.replace(/[|]/g, ' ').replace(/(\d)[oO](?=[\doO]|\s*m?g\b)/g, '$10').replace(/(\d)[oO](?=\d|\s*m?g\b)/g, '$10').replace(/\s+/g, ' ');
  const num = s => (s == null ? null : +s.replace(',', '.'));
  const grab = (re) => { const m = t.match(re); return m ? num(m[1]) : null; };
  const servingM = t.match(/serving size\s*([^]*?)\(?\s*(\d+(?:\.\d+)?)\s*(g|ml)\s*\)?/i);
  const n = {
    kcal: grab(/calories\s*(\d{1,4})/i),
    f: grab(/total fat\s*(\d+(?:[.,]\d+)?)\s*g/i),
    c: grab(/total carb[a-z.]*\s*(\d+(?:[.,]\d+)?)\s*g/i),
    fib: grab(/(?:dietary )?fiber\s*(\d+(?:[.,]\d+)?)\s*g/i),
    sug: grab(/total sugars?\s*(\d+(?:[.,]\d+)?)\s*g/i) ?? grab(/sugars?\s*(\d+(?:[.,]\d+)?)\s*g/i),
    p: grab(/protein\s*(\d+(?:[.,]\d+)?)\s*g/i),
    na: grab(/sodium\s*(\d+(?:[.,]\d+)?)\s*mg/i),
  };
  return {
    name: '', brand: '', notes: 'Read with on-device OCR. Double-check every number.',
    servingLabel: servingM ? `${servingM[1].trim()} (${servingM[2]}${servingM[3]})`.replace(/^\(/, '').trim() : '1 serving',
    servingG: servingM ? num(servingM[2]) : null, n,
  };
}

// Last-used reader sticks: 'claude' | 'ocr'.
export const reader = {
  get: () => (local.get('anthropicKey', '') ? local.get('labelReader', 'ocr') : 'ocr'),
  set: v => local.set('labelReader', v),
};
