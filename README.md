# WissenLebtOnline Lernpfadfinder

POC: Nutzer gibt ein Lernziel ein → Wikidata-Themengraph wird live aufgebaut → LLM (OpenAI `gpt-5.4-mini`) klassifiziert Kanten didaktisch (Voraussetzung / Vertiefung / Anwendung) → Nutzer markiert Vorwissen → individueller Lernpfad mit Druckansicht.

## Pipeline (3 Phasen)

1. **Struktur** — Wikidata SPARQL: `P279` (Unterklasse), `P361` (Teil von), `P527` (hat Teil) rekursiv (±2 Ebenen) → React-Flow Graph baut sich animiert auf.
2. **Didaktik** — parallele LLM-Calls (Batches à 6 Kanten) via SSE-Streaming klassifizieren jede Kante (`prerequisite` | `extends` | `applies` | `related`) und jeden Knoten (`prerequisite` | `core` | `advanced`). Pfeile werden live eingefärbt.
3. **Vorwissen → Pfad** — Klick auf Knoten (oder Freitext/Voice → LLM-Extraktion) markiert Bekanntes. Topologische Sortierung der Voraussetzungen des Lernziels → nummerierter, druckbarer Lernpfad.

## Voice

- **STT**: `gpt-4o-transcribe` (Button halten → sprechen → loslassen → Transkript)
- **TTS**: `gpt-4o-mini-tts` (Begrüßung, Start-Knoten werden gesprochen)

## Env Variablen (Vercel)

```
OPENAI_API_KEY=sk-...         # Pflicht
OPENAI_MODEL=gpt-5.4-mini     # Default für chat/reasoning/didactic/knowledge
OPENAI_STT_MODEL=gpt-4o-transcribe
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=alloy        # alloy|echo|fable|onyx|nova|shimmer|...
```

## Lokal starten

```bash
npm install
cp .env.example .env.local   # OPENAI_API_KEY eintragen
npm run dev                  # http://localhost:3400
```

## Deploy auf Vercel

1. Repo anlegen, `lernpfadfinder/` als Root des Projekts wählen.
2. Environment Variable `OPENAI_API_KEY` setzen (Production + Preview).
3. Deploy — Framework wird automatisch als Next.js erkannt.

## Architektur

```
app/
  page.tsx               # Routing zwischen Welcome / GraphView
  layout.tsx globals.css
  api/
    resolve/route.ts     # Wikidata wbsearchentities (Disambiguierung)
    wikidata/route.ts    # SPARQL-Proxy, baut Rohgraph
    didactic/route.ts    # SSE: parallele LLM-Edge/Node-Klassifikation
    parse-knowledge/     # Freitext → bekannte Q-IDs
    stt/route.ts         # Whisper/gpt-4o-transcribe
    tts/route.ts         # gpt-4o-mini-tts
components/
  WelcomeScreen.tsx      # zentrierte Begrüßung + Voice-Input
  GraphView.tsx          # Phasen-Orchestrierung + Sidepanels
  GraphCanvas.tsx        # React-Flow Rendering
  VoiceButton.tsx        # Mic (hold-to-record) + speak()
lib/
  wikidata.ts            # SPARQL + Search
  graph.ts               # dagre-Layout + Pfadberechnung (topo-Sort)
  openai.ts              # Client + Modellnamen
  store.ts               # Zustand: Phase, Graph, Target, Path
  types.ts
```

## Offene Punkte / Nächste Schritte

- **Rekursive Vertiefung**: aktuell 2 Ebenen — für tiefere Exploration könnten die LLM-Vorschläge (`addNode`) persistiert werden.
- **Caching**: Graph+Didaktik sollten pro Q-ID gecacht werden (Vercel KV / Upstash).
- **WLO-Anbindung**: pro Lernpfad-Knoten WLO-OER-Ressourcen via MCP nachladen.
- **Parallele Voice-Konversation**: optional `gpt-4o-realtime` als Chat-Companion.
