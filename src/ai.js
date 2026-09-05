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

const CONTACTS_NOTE = `Regola per il titolo — se l'attività ha un INTERLOCUTORE (fornitore, ente, assicurazione, persona da contattare), il titolo è "INTERLOCUTORE - Azione essenziale", con il nome in MAIUSCOLO e l'azione ridotta all'osso, all'infinito:
- "TARI - Comunicare nuova residenza"
- "ZURICH - Comunicare nuova residenza"
- "FRATONI - Chiedere quando Ponziani viene a fare le rifiniture"
Se non c'è un interlocutore (acquisti, lavoretti da fare da soli), usa solo l'azione, breve e pulita.
Fornitori di fiducia della famiglia: FRATONI (impresa, lavori e rifiniture), PONZIANI, CHIARA, TURBOPAOLO. Attenzione: Ponziani si contatta tramite Fratoni, quindi le richieste che riguardano Ponziani hanno come interlocutore FRATONI (Ponziani si cita nell'azione). Enti/utenze tipiche: TARI, ZURICH, ENEL, ecc.`;

const SYSTEM_PROMPT = `Sei l'assistente di una lista di lavori e lavoretti di casa (trasloco appena fatto, Italia).
Ricevi il testo di una nuova attività scritta in linguaggio naturale e la classifichi.

Il testo può contenere refusi: interpretalo comunque ("comrare tende" = "comprare tende").

${CONTACTS_NOTE}

Rispondi SOLO con un oggetto JSON valido, senza markdown né testo extra, con questi campi:
- "title": il titolo dell'attività secondo la regola sopra (massimo ~60 caratteri, prima lettera maiuscola)
- "stores": array dei negozi dove si può risolvere l'attività, se implica un acquisto (da 1 a 3, in ordine di plausibilità). Includi sempre il negozio citato nel testo, se presente; altrimenti deduci i più plausibili per quel prodotto tra: "IKEA", "Leroy Merlin", "Brico", "OBI", "Amazon", "Supermercato", "Ferramenta", "Farmacia", "Mediaworld" (esempio: tende → ["IKEA","Leroy Merlin"]). Se non serve comprare nulla: []
- "room": la stanza interessata, una tra: "Cucina", "Bagno", "Camera", "Soggiorno", "Corridoio", "Balcone", "Garage", "Studio", "Tutta casa". Se non deducibile: null
- "category": una tra: "Acquisto", "Montaggio", "Riparazione", "Pulizia", "Elettricità", "Idraulica", "Decorazione", "Burocrazia", "Chiamare", "Trasloco", "Altro"
- "priority": "alta", "media" o "bassa" (deducila dal tono e dall'urgenza pratica; in dubbio "media")
- "cost": stima realistica del costo in euro (numero intero) se l'attività comporta una spesa; altrimenti null
- "due": SOLO se il testo indica un termine temporale ("entro venerdì", "domani", "prima del 20"): la data corrispondente in formato "YYYY-MM-DD"; altrimenti null

Esempio input: "comprare le lampadine E27 per il corridoio quando passo da ikea"
Esempio output: {"title":"Comprare lampadine E27 per il corridoio","stores":["IKEA","Leroy Merlin"],"room":"Corridoio","category":"Acquisto","priority":"media","cost":15,"due":null}`;

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

// Interlocutori noti per il formato "INTERLOCUTORE - Azione" (Ponziani si contatta tramite Fratoni)
const KNOWN_CONTACTS = [
  { re: /\bfratoni\b/i, name: 'FRATONI', strip: /\b(?:a|al|con|da|di)?\s*fratoni\b/i },
  { re: /\bponziani\b/i, name: 'FRATONI', strip: null },
  { re: /\bchiara\b/i, name: 'CHIARA', strip: /\b(?:a|con|da|di)?\s*chiara\b/i },
  { re: /\bturbo\s?paolo\b/i, name: 'TURBOPAOLO', strip: /\b(?:a|con|da|di)?\s*turbo\s?paolo\b/i },
  { re: /\btari\b/i, name: 'TARI', strip: /\b(?:alla|della|per la|la)?\s*tari\b/i },
  { re: /\bzurich\b/i, name: 'ZURICH', strip: /\b(?:alla|a|della|con)?\s*zurich\b/i },
  { re: /\benel\b/i, name: 'ENEL', strip: /\b(?:all'|a|dell'|con)?\s*enel\b/i },
];

const PROPER_NAMES = { fratoni: 'Fratoni', ponziani: 'Ponziani', chiara: 'Chiara', turbopaolo: 'Turbopaolo' };

function contactTitle(raw) {
  const contact = KNOWN_CONTACTS.find((c) => c.re.test(raw));
  if (!contact) return null;
  let action = raw
    .replace(/^(chiamare|telefonare a|sentire|contattare|scrivere a|chiedere a|comunicare a(?:lla)?)\s+/i, '')
    .replace(contact.strip || /$^/, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.:;–-]+|[\s,.:;–-]+$/g, '')
    .replace(/^(?:a|al|alla|allo|ai|agli|da|dal|dalla|con|per|il|la|lo)\s+/i, '');
  if (action.length < 3) action = raw.trim();
  for (const [lower, proper] of Object.entries(PROPER_NAMES)) {
    action = action.replace(new RegExp(`\\b${lower}\\b`, 'gi'), proper);
  }
  return `${contact.name} - ${action.charAt(0).toUpperCase()}${action.slice(1)}`;
}

const CATEGORY_KEYWORDS = {
  chiama: 'Chiamare',
  telefona: 'Chiamare',
  sentire: 'Chiamare',
  chiedere: 'Chiamare',
  contatta: 'Chiamare',
  comunicare: 'Burocrazia',
  disdire: 'Burocrazia',
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
  const plain = text.trim().replace(/\s+/g, ' ');
  const title = contactTitle(plain) || plain.charAt(0).toUpperCase() + plain.slice(1);
  return {
    title,
    store: stores.slice(0, 3).join(', ') || null,
    room: pick(ROOM_KEYWORDS),
    category,
    priority: /urgent|subito|importante|priorit/i.test(text) ? 'alta' : 'media',
    cost: null,
    due: null,
    ai_source: 'euristica',
  };
}

function sanitize(result, fallbackTitle) {
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const priority = ['alta', 'media', 'bassa'].includes(result.priority) ? result.priority : 'media';
  // Accetta sia il nuovo formato "stores" (array) sia un eventuale "store" singolo
  const rawStores = Array.isArray(result.stores) ? result.stores : [result.store];
  const stores = [...new Set(rawStores.map(str).filter(Boolean))].slice(0, 3);
  const cost = Number.isFinite(Number(result.cost)) && Number(result.cost) > 0 ? Math.round(Number(result.cost)) : null;
  const due = typeof result.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(result.due) ? result.due : null;
  return {
    title: str(result.title) || fallbackTitle,
    store: stores.join(', ') || null,
    room: str(result.room),
    category: str(result.category) || 'Altro',
    priority,
    cost,
    due,
    ai_source: 'ai',
  };
}

const LIST_PROMPT = `Sei l'assistente di una lista di lavori e lavoretti di casa (trasloco appena fatto, Italia).
Ricevi un elenco di attività — testo libero, appunti, o la trascrizione di una lista scritta a mano — e lo trasformi in attività strutturate.
Il testo può contenere refusi o abbreviazioni: interpretali. Ignora righe che non sono attività (titoli, date, scarabocchi).

${CONTACTS_NOTE}

Rispondi SOLO con un array JSON valido, senza markdown né testo extra. Ogni elemento ha i campi:
"title", "stores" (array, anche vuoto), "room", "category", "priority", "cost", "due" — con le stesse regole seguenti:
- "title": secondo la regola sopra, massimo ~60 caratteri, prima lettera maiuscola
- "stores": da 0 a 3 negozi dove si può risolvere, tra: "IKEA", "Leroy Merlin", "Brico", "OBI", "Amazon", "Supermercato", "Ferramenta", "Farmacia", "Mediaworld" (o il negozio citato nel testo)
- "room": una tra "Cucina", "Bagno", "Camera", "Soggiorno", "Corridoio", "Balcone", "Garage", "Studio", "Tutta casa", oppure null
- "category": una tra "Acquisto", "Montaggio", "Riparazione", "Pulizia", "Elettricità", "Idraulica", "Decorazione", "Burocrazia", "Chiamare", "Trasloco", "Altro"
- "priority": "alta" | "media" | "bassa"
- "cost": stima in euro (numero intero) se comporta una spesa, altrimenti null
- "due": "YYYY-MM-DD" solo se indicato un termine, altrimenti null

Massimo 50 attività.`;

function parseJsonArray(raw) {
  const cleaned = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error('Risposta non è un array');
  return parsed;
}

function heuristicExtract(text) {
  return text
    .split(/\n|;|•/)
    .map((line) => line.replace(/^\s*[-*·\d.)\]]+\s*/, '').trim())
    .filter((line) => line.length > 2)
    .slice(0, 50)
    .map(heuristicClassify);
}

// Elenco testuale (più righe) → array di attività classificate
export async function extractTasks(text) {
  const fallback = heuristicExtract(text);
  if (!client) return fallback;
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      output_config: { effort: 'low' },
      system: `${LIST_PROMPT}\n\nOggi è ${new Date().toISOString().slice(0, 10)}.`,
      messages: [{ role: 'user', content: text }],
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    const items = parseJsonArray(textBlock.text);
    const out = items.map((item) => sanitize(item, String(item.title || '').slice(0, 80) || 'Attività')).filter((t) => t.title);
    return out.length ? out : fallback;
  } catch (err) {
    console.error('[ai] estrazione elenco fallita, uso euristica:', err.message);
    return fallback;
  }
}

// Foto di una lista (scritta a mano o stampata) → array di attività classificate
export async function extractTasksFromImage(base64, mediaType) {
  if (!client) {
    const err = new Error('La lettura delle foto richiede la chiave AI (ANTHROPIC_API_KEY)');
    err.status = 503;
    throw err;
  }
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: `${LIST_PROMPT}\n\nOggi è ${new Date().toISOString().slice(0, 10)}.`,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: 'Leggi la lista in questa foto ed estrai le attività.' },
        ],
      },
    ],
  });
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('Nessun testo riconosciuto nella foto');
  const items = parseJsonArray(textBlock.text);
  return items.map((item) => sanitize(item, String(item.title || '').slice(0, 80) || 'Attività')).filter((t) => t.title);
}

export async function classify(text) {
  const fallback = heuristicClassify(text);
  if (!client) return fallback;
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      output_config: { effort: 'low' },
      system: `${SYSTEM_PROMPT}\n\nOggi è ${new Date().toISOString().slice(0, 10)}.`,
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
