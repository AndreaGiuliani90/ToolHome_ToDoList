// Classificazione delle attività: Claude (SDK ufficiale Anthropic) con fallback euristico
// quando la chiave API non è configurata o la chiamata fallisce.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.AI_MODEL || 'claude-opus-5';

let client = null;
try {
  // Zero-arg: risolve ANTHROPIC_API_KEY o un profilo `ant auth login`; lancia se non c'è nulla
  client = new Anthropic();
} catch {
  client = null;
}

export const AI_ENABLED = Boolean(client);

const SYSTEM_PROMPT = `Sei l'assistente di una lista di lavori e lavoretti di casa (trasloco appena fatto, Italia).
Ricevi il testo di una nuova attività scritta in linguaggio naturale e la classifichi.

Il testo può contenere refusi: interpretalo comunque ("comrare tende" = "comprare tende").

Rispondi SOLO con un oggetto JSON valido, senza markdown né testo extra, con questi campi:
- "title": il titolo dell'attività, breve e pulito (riformula il testo correggendo i refusi, massimo ~60 caratteri, prima lettera maiuscola)
- "stores": array dei negozi dove si può risolvere l'attività, se implica un acquisto (da 1 a 3, in ordine di plausibilità). Includi sempre il negozio citato nel testo, se presente; altrimenti deduci i più plausibili per quel prodotto tra: "IKEA", "Leroy Merlin", "Brico", "OBI", "Amazon", "Supermercato", "Ferramenta", "Farmacia", "Mediaworld" (esempio: tende → ["IKEA","Leroy Merlin"]). Se non serve comprare nulla: []
- "room": la stanza interessata, una tra: "Cucina", "Bagno", "Camera", "Soggiorno", "Corridoio", "Balcone", "Garage", "Studio", "Tutta casa". Se non deducibile: null
- "category": una tra: "Acquisto", "Montaggio", "Riparazione", "Pulizia", "Elettricità", "Idraulica", "Decorazione", "Burocrazia", "Trasloco", "Altro"
- "priority": "alta", "media" o "bassa" (deducila dal tono e dall'urgenza pratica; in dubbio "media")

Esempio input: "comprare le lampadine E27 per il corridoio quando passo da ikea"
Esempio output: {"title":"Comprare lampadine E27 per il corridoio","stores":["IKEA","Leroy Merlin"],"room":"Corridoio","category":"Acquisto","priority":"media"}`;

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

// Prodotto → negozi plausibili (usato quando nel testo non è citato un negozio)
const PRODUCT_STORE_HINTS = {
  tend: ['IKEA', 'Leroy Merlin'],
  lampad: ['IKEA', 'Leroy Merlin'],
  mobil: ['IKEA'],
  scaffal: ['IKEA', 'Leroy Merlin'],
  libreri: ['IKEA'],
  cassettier: ['IKEA'],
  armadio: ['IKEA'],
  material: ['IKEA', 'Amazon'],
  cuscin: ['IKEA'],
  lenzuol: ['IKEA'],
  copripiumin: ['IKEA'],
  stovigli: ['IKEA', 'Supermercato'],
  pentol: ['IKEA', 'Supermercato'],
  frigo: ['Mediaworld', 'Amazon'],
  lavatrice: ['Mediaworld'],
  lavastovigli: ['Mediaworld'],
  forno: ['Mediaworld'],
  microonde: ['Mediaworld', 'Amazon'],
  aspirapolver: ['Mediaworld', 'Amazon'],
  televisor: ['Mediaworld', 'Amazon'],
  trapan: ['Brico', 'Leroy Merlin'],
  vit: ['Ferramenta', 'Brico'],
  tassell: ['Ferramenta', 'Brico'],
  utensil: ['Brico', 'Leroy Merlin'],
  vernic: ['Leroy Merlin', 'Brico'],
  piant: ['Leroy Merlin', 'OBI'],
  vas: ['Leroy Merlin', 'OBI'],
  detersiv: ['Supermercato'],
  guarnizion: ['Ferramenta', 'Brico'],
};

function heuristicClassify(text) {
  const lower = ` ${text.toLowerCase()} `;
  const pick = (map) => {
    for (const [kw, value] of Object.entries(map)) {
      if (lower.includes(kw)) return value;
    }
    return null;
  };
  // Negozi: prima quelli citati nel testo, poi quelli plausibili per il prodotto
  const stores = [];
  for (const [kw, store] of Object.entries(STORE_KEYWORDS)) {
    if (lower.includes(kw) && !stores.includes(store)) stores.push(store);
  }
  if (!stores.length) {
    for (const [kw, hinted] of Object.entries(PRODUCT_STORE_HINTS)) {
      if (!lower.includes(kw)) continue;
      for (const store of hinted) if (!stores.includes(store)) stores.push(store);
    }
  }
  const category = pick(CATEGORY_KEYWORDS) || (stores.length ? 'Acquisto' : 'Altro');
  const title = text.trim().replace(/\s+/g, ' ');
  return {
    title: title.charAt(0).toUpperCase() + title.slice(1),
    store: stores.slice(0, 3).join(', ') || null,
    room: pick(ROOM_KEYWORDS),
    category,
    priority: /urgent|subito|importante|priorit/i.test(text) ? 'alta' : 'media',
    ai_source: 'euristica',
  };
}

function sanitize(result, fallbackTitle) {
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const priority = ['alta', 'media', 'bassa'].includes(result.priority) ? result.priority : 'media';
  // Accetta sia il nuovo formato "stores" (array) sia un eventuale "store" singolo
  const rawStores = Array.isArray(result.stores) ? result.stores : [result.store];
  const stores = [...new Set(rawStores.map(str).filter(Boolean))].slice(0, 3);
  return {
    title: str(result.title) || fallbackTitle,
    store: stores.join(', ') || null,
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
