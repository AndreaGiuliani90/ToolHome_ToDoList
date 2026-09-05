# 🏠 Casa Tasks

Lista condivisa dei lavori e lavoretti di casa, con classificazione automatica via AI.

Scrivi un'attività in linguaggio naturale («comprare lampadine E27 da IKEA per il corridoio») e l'app le assegna automaticamente **negozio**, **stanza**, **categoria** e **priorità**. Poi, quando sei da IKEA, filtri per IKEA e vedi tutto quello che puoi risolvere lì.

## Funzionalità

- ✍️ Inserimento in linguaggio naturale, classificazione automatica con Claude (Anthropic)
- 🔎 Filtri istantanei per negozio, stanza, categoria, stato + ricerca testuale
- ✅ Completamento, modifica manuale dei tag, note, priorità
- 🔐 Due modalità di accesso: **semplice** ("Chi sei?" tra i nomi di `SIMPLE_USERS`, default) oppure **Google** (impostando `GOOGLE_CLIENT_ID`; i nuovi utenti restano "in attesa" finché un admin non li approva)
- 👥 Pagina admin per approvare/revocare gli utenti (la lista è condivisa tra gli approvati)
- 📱 Ottimizzata per mobile e desktop, tema chiaro/scuro automatico
- 📺 Modalità TV (pulsante 📺, o automatica sul browser Silk del Firestick): testi grandi e navigazione con le frecce del telecomando
- 🗄️ SQLite in locale (zero configurazione), Postgres in produzione

## Avvio in locale

```bash
npm install
npm run dev
```

Apri http://localhost:3000. Senza `GOOGLE_CLIENT_ID` compare l'accesso semplice **"Chi sei?"** (nomi da `SIMPLE_USERS`, default Andrea/Stefania/Brunello). Senza `ANTHROPIC_API_KEY` la classificazione usa un'euristica di base a parole chiave.

Per provare l'AI in locale: copia `.env.example` in `.env`, metti la chiave e avvia con:

```bash
node --env-file=.env server.js
```

## Variabili d'ambiente

| Variabile | Obbligatoria | Descrizione |
|---|---|---|
| `SIMPLE_USERS` | No | Nomi (separati da virgola) per l'accesso semplice; il primo è l'admin. Default: `Andrea,Stefania,Brunello` |
| `GOOGLE_CLIENT_ID` | No | Se impostato, attiva la login Google al posto dell'accesso semplice |
| `ADMIN_EMAILS` | Solo modalità Google | Email (separate da virgola) approvate come admin al primo login |
| `SESSION_SECRET` | Consigliata | Stringa lunga casuale per firmare le sessioni |
| `ANTHROPIC_API_KEY` | Consigliata | Chiave API Anthropic per la classificazione AI |
| `AI_MODEL` | No | Default `claude-opus-5`; alternativa economica: `claude-haiku-4-5` |
| `DATABASE_URL` | Impostata da Railway | Connessione Postgres (senza: SQLite locale) |
| `NODE_ENV` | Sì in produzione | Impostare a `production` |

## Configurare il login Google (una tantum, ~5 minuti)

1. Vai su https://console.cloud.google.com/apis/credentials (crea un progetto se non ne hai uno, es. "casa-tasks").
2. Configura la **schermata di consenso OAuth** (tipo "Esterno" va bene, aggiungi solo nome app e la tua email; non serve la verifica di Google per un uso personale).
3. **Crea credenziali → ID client OAuth → Applicazione web**:
   - *Origini JavaScript autorizzate*: `http://localhost:3000` e poi l'URL Railway (es. `https://casa-tasks-production.up.railway.app`)
   - *URI di reindirizzamento*: non servono (usiamo Google Identity Services, non il redirect)
4. Copia il **Client ID** (finisce con `.apps.googleusercontent.com`) nella variabile `GOOGLE_CLIENT_ID`.

## Deploy su Railway

1. Pubblica questo repository su GitHub.
2. Su https://railway.app → **New Project → Deploy from GitHub repo** → scegli il repo.
3. Nello stesso progetto: **+ New → Database → PostgreSQL**. Railway collega `DATABASE_URL` al servizio (se non lo fa da solo: nelle variabili del servizio app aggiungi `DATABASE_URL` = riferimento a `${{Postgres.DATABASE_URL}}`).
4. Nelle **Variables** del servizio app imposta: `GOOGLE_CLIENT_ID`, `ADMIN_EMAILS`, `SESSION_SECRET`, `ANTHROPIC_API_KEY`, `NODE_ENV=production`.
5. In **Settings → Networking → Generate Domain** per ottenere l'URL pubblico, e aggiungi quell'URL alle *Origini JavaScript autorizzate* del client Google (punto 3 sopra).

A ogni `git push` su GitHub, Railway rideploya da solo.

## Firestick / Alexa

- **Oggi**: apri l'app dal browser **Silk** del Firestick — la modalità TV si attiva da sola (testi grandi, navigazione con le frecce del telecomando).
- **Fase 2 (skill Alexa vocale)**: le API REST (`/api/tasks` in GET/POST) sono già la base; servirà un endpoint autenticato con token per la skill e un account Amazon Developer.

## Struttura

```
server.js        Express: API REST + file statici
src/db.js        Strato dati (Postgres o SQLite)
src/auth.js      Login Google, sessioni, autorizzazioni
src/ai.js        Classificazione con Claude + fallback euristico
public/          Frontend (HTML/CSS/JS senza framework)
```
