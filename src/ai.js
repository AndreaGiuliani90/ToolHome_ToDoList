// Classificazione delle attività: Claude (SDK ufficiale Anthropic) con fallback euristico
// quando la chiave API non è configurata o la chiamata fallisce.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.AI_MODEL || 'claude-opus-5';

let client = null;
try {
  if (process.env.ANTHROPIC_API_KEY) client = new Anthropic();
} catch {
  client = null;
}

export const AI_ENABLED = Boolean(client);

const SYSTEM_PROMPT = `Sei l'assistente di una lista di lavori e lavoretti di casa (trasloco appena fatto, Italia).
Ricevi il testo di una nuova attività scritta in linguaggio naturale e la classifichi.

Rispondi SOLO con un oggetto JSON valido, senza markdown né testo extra, con questi campi:
- "title": il titolo dell'attività, breve e pulito (riformula il testo, massimo ~60 caratteri, prima lettera maiuscola)
- "store": il negozio dove si può risolvere, se l'attività implica un acquisto. Usa il negozio citato nel testo se presente; altrimenti scegli il più plausibile tra: "IKEA", "Leroy Merlin", "Brico", "OBI", "Amazon", "Supermercato", "Ferramenta", "Farmacia", "Mediaworld". Se non serve comprare nulla: null
- "room": la stanza interessata, una tra: "Cucina", "Bagno", "Camera", "Soggiorno", "Corridoio", "Balcone", "Garage", "Studio", "Tutta casa". Se non deducibile: null
- "category": una tra: "Acquisto", "Montaggio", "Riparazione", "Pulizia", "Elettricità", "Idraulica", "Decorazione", "Burocrazia", "Trasloco", "Altro"
- "priority": "alta", "media" o "bassa" (deducila dal tono e dall'urgenza pratica; in dubbio "media")

Esempio input: "comprare le lampadine E27 per il corridoio quando passo da ikea"
Esempio output: {"title":"Comprare lampadine E27 per il corridoio","store":"IKEA","room":"Corridoio","category":"Acquisto","priority":"media"}`;

const STORE_KEYWORDS = {
  ikea: 'IKEA',
  'leroy merlin': 'Leroy Merlin',
  leroy: 'Leroy Merlin',
  brico: 'Brico',
  obi: 'OBI',
  amazon: 'Amazon',
  supermercato: 'Supermercato',
  ferramenta: 'Ferramenta',
  farmacia: 'Farmacia',
  mediaworld: 'Mediaworld',
};

const ROOM_KEYWORDS = {
  cucina: 'Cucina',
  bagno: 'Bagno',
  camera: 'Camera',
  soggiorno: 'Soggiorno',
  salotto: 'Soggiorno',
  corridoio: 'Corridoio',
  ingresso: 'Corridoio',
  balcone: 'Balcone',
  terrazzo: 'Balcone',
  garage: 'Garage',
  cantina: 'Garage',
  studio: 'Studio',
};

const CATEGORY_KEYWORDS = {
  compra: 'Acquisto',
  acquist: 'Acquisto',
  prendere: 'Acquisto',
  ordina: 'Acquisto',
  monta: 'Montaggio',
  installa: 'Montaggio',
  appendere: 'Montaggio',
  ripara: 'Riparazione',
  aggiusta: 'Riparazione',
  sistemare: 'Riparazione',
  puli: 'Pulizia',
  lava: 'Pulizia',
  lampad: 'Elettricità',
  'presa ': 'Elettricità',
  elettric: 'Elettricità',
  rubinetto: 'Idraulica',
  perdita: 'Idraulica',
  scarico: 'Idraulica',
  tenda: 'Decorazione',
  quadro: 'Decorazione',
  vernic: 'Decorazione',
  imbianc: 'Decorazione',
  residenza: 'Burocrazia',
  contratto: 'Burocrazia',
  volt: 'Burocrazia',
  utenz: 'Burocrazia',
  scatol: 'Trasloco',
  trasloc: 'Trasloco',
};

function heuristicClassify(text) {
  const lower = ` ${text.toLowerCase()} `;
  const pick = (map) => {
    for (const [kw, value] of Object.entries(map)) {
      if (lower.includes(kw)) return value;
    }
    return null;
  };
  const title = text.trim().replace(/\s+/g, ' ');
  return {
    title: title.charAt(0).toUpperCase() + title.slice(1),
    store: pick(STORE_KEYWORDS),
    room: pick(ROOM_KEYWORDS),
    category: pick(CATEGORY_KEYWORDS) || 'Altro',
    priority: /urgent|subito|importante|priorit/i.test(text) ? 'alta' : 'media',
    ai_source: 'euristica',
  };
}

function sanitize(result, fallbackTitle) {
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const priority = ['alta', 'media', 'bassa'].includes(result.priority) ? result.priority : 'media';
  return {
    title: str(result.title) || fallbackTitle,
    store: str(result.store),
    room: str(result.room),
    category: str(result.category) || 'Altro',
    priority,
    ai_source: 'ai',
  };
}

export async function classify(text) {
  const fallback = heuristicClassify(text);
  if (!client) return fallback;
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      output_config: { effort: 'low' },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: text }],
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock) return fallback;
    const raw = textBlock.text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(raw);
    return sanitize(parsed, fallback.title);
  } catch (err) {
    console.error('[ai] classificazione fallita, uso euristica:', err.message);
    return fallback;
  }
}
