# Dein Lernpfadfinder

Ein KI-Assistent, der aus einem Lernziel einen **persönlichen, lückenlosen Lernpfad** macht — mit passenden offenen Lernmaterialien zu jedem Schritt.

> Sag dein Lernziel → beantworte kurz ein paar Fragen zu Vorwissen und Anlass → bekomme einen Lernbaum mit Zeiten, Prüfaufgaben und Materialien pro Schritt. Alles kann am Ende ausgedruckt werden.

## Features

- **Rekursive LLM-Zerlegung** des Themas in Cluster → Unter-Cluster → atomare Lernschritte
- **Persönliche Baseline**: Bildungsstufe, Vorwissen, Anlass (Prüfung, Hausaufgaben, Hobby, …), Zeitbudget/Deadline
- **Lernpfad-Reihenfolge** nach Voraussetzungen, Bildungsstufe, Zeit und Schwierigkeit
- **Themenbaum-Ansicht** mit Live-Suche, „Alle auf/zu"-Controls, Ebenen-Schnellwahl
- **Graph-Ansicht** (React Flow) als alternative Visualisierung
- **LLM-Steckbrief** zum Pfad (Gesamteinschätzung, größter Aufwand, kritische Voraussetzungen, Zeitpassung)
- **Detail-Drawer** mit passenden **Lernmaterialien** (per Klick auf 📚-Button)
- **Voice-Input/Output** (STT + TTS) für Barrierefreiheit
- **Druckansicht** mit den nächsten 3 Schritten inkl. Materiallinks
- **Session-Persistenz** im Browser (localStorage) — Fortsetzen nach Reload

## Quickstart (lokal)

Voraussetzungen: Node.js ≥ 18.17, npm, gültiger OpenAI-API-Key.

```bash
cd lernpfadfinder
npm install
cp .env.example .env.local        # dann OPENAI_API_KEY eintragen
npm run dev                       # http://localhost:3400
```

> Hinweis Windows PowerShell: `Copy-Item .env.example .env.local`

## Environment-Variablen

Nur `OPENAI_API_KEY` ist Pflicht. Alle weiteren Werte haben Defaults.

| Variable | Default | Zweck |
|---|---|---|
| `OPENAI_API_KEY` | *(leer)* | **Pflicht** — API-Key |
| `OPENAI_MODEL` | `gpt-5.4-mini` | Modell für Disambiguierung, Graph-Generierung, Steckbrief |
| `OPENAI_STT_MODEL` | `gpt-4o-transcribe` | Speech-to-Text für Voice-Input |
| `OPENAI_TTS_MODEL` | `gpt-4o-mini-tts` | Text-to-Speech für Begrüßung |
| `OPENAI_TTS_VOICE` | `alloy` | Stimme (`alloy`/`echo`/`fable`/`onyx`/`nova`/`shimmer`) |

Die komplette Vorlage steht in `.env.example`.

## Nutzungsablauf

1. **Welcome** — Lernziel eingeben oder einsprechen. Bei mehrdeutigen Begriffen (z. B. „Zelle") bietet die App Disambiguierungs-Optionen an.
2. **Baseline** — Bildungsstufe wählen, Vorwissen in Freitext beschreiben, Anlass/Zeitbudget/Deadline (optional) angeben.
3. **Generierung** — Der Lernbaum wird streaming aufgebaut (SSE). Cluster und Blätter erscheinen live.
4. **Explore** — Markiere, was du bereits kannst. Per Klick auf eine Box (Leaf oder Cluster-Teilbaum) oder über die Stufen-Schnellwahl im Panel. Ein Klick auf 📚 öffnet den Detail-Drawer mit passenden Lernmaterialien.
5. **Pfad** — Nummerierter, zeitlich sortierter Lernpfad. Mit Steckbrief (was kommt auf mich zu?), Prüfaufgaben und Druck-Button.
6. **Drucken** — Browser-Druck (Cmd/Ctrl+P) rendert eine kompakte Version: Header, Steckbrief, Pfadliste, Materialien zu den nächsten 3 offenen Schritten.

Die Session wird automatisch in `localStorage` persistiert — beim Reload landest du wieder in der letzten Phase. „Neues Thema" im Header löscht die Session.

## Deployment auf Vercel

1. Repo auf GitHub/GitLab pushen.
2. In Vercel „Import Project" → Root-Verzeichnis auf `lernpfadfinder/` setzen.
3. Framework wird automatisch als **Next.js** erkannt (Build: `next build`, Output: `.next`).
4. Environment-Variable `OPENAI_API_KEY` in Production **und** Preview setzen.
5. Deploy.

### Kompatibilität

| Thema | Status | Anmerkung |
|---|---|---|
| Framework | ✅ Next.js 15 App Router | nativ unterstützt |
| API-Routes | ✅ Node-Runtime (`runtime='nodejs'`) | explizit gesetzt |
| SSE-Streaming | ✅ `ReadableStream` in `/api/generate` | funktioniert in Vercel Functions |
| `maxDuration` | ⚠️ `/api/generate`: 120 s | **erfordert Vercel Pro** (Hobby: 60 s; Edge: 25 s) |
| Outbound Fetch | ✅ OpenAI + externer OER-Materialien-Endpoint | keine Besonderheiten |
| State | ✅ `zustand` client-seitig + `localStorage` | kein externer Store nötig |
| In-Memory-Cache | ⚠️ pro Function-Instanz | keine Cross-Instance-Persistenz — best-effort, ok für POC |

Die Timeouts pro Route werden zusätzlich in [`vercel.json`](./vercel.json) gesetzt. Wenn du auf Vercel Hobby bleibst, reduziere `/api/generate` entweder auf ≤ 60 s oder verwende Fluid Compute (falls verfügbar).

### Alternative Hosts

- **Selbst gehostet** (Docker/Node): `npm run build && npm run start` — keine Limits außer dem Request-Timeout des Reverse-Proxys.
- **Cloudflare / Edge-Runtime**: *nicht* out-of-the-box, weil `openai` das Node-SDK nutzt und alle Routes explizit Node-Runtime verlangen.

## Projektstruktur

```
lernpfadfinder/
├── app/
│   ├── page.tsx              # Phase-Router (welcome → baseline → explore → path)
│   ├── layout.tsx, globals.css
│   └── api/
│       ├── disambiguate/     # Mehrdeutige Begriffe auflösen
│       ├── generate/         # Streaming-Graph-Generation (SSE)
│       ├── summary/          # LLM-Steckbrief zum Pfad
│       ├── wlo/              # Proxy + Cache für den Materialien-Suchendpoint
│       ├── stt/              # Speech-to-Text
│       └── tts/              # Text-to-Speech
├── components/
│   ├── WelcomeScreen.tsx     # Einstieg mit Voice-Input
│   ├── BaselineScreen.tsx    # Vorwissen, Anlass, Zeitbudget
│   ├── GraphView.tsx         # Phasen-Orchestrierung + Side-Panels
│   ├── TreeView.tsx          # Outline-/Themenbaum-Ansicht
│   ├── GraphCanvas.tsx       # React-Flow Rendering
│   ├── NodeDetailDrawer.tsx  # Detail + passende Lernmaterialien
│   ├── PathSummaryCard.tsx   # Steckbrief-Card
│   ├── PrintView.tsx         # Druckansicht
│   ├── SessionPersister.tsx  # localStorage-Rehydrate
│   └── VoiceButton.tsx
├── lib/
│   ├── graph.ts              # Dedup, Zyklen-Break, Pfadberechnung, Layout
│   ├── openai.ts             # OpenAI-Client (Singleton)
│   ├── persistence.ts        # Snapshot-Schema v1
│   ├── store.ts              # Zustand (Phase, Graph, Path, Baseline, …)
│   ├── types.ts              # Topic, Edge, EducationLevel, LearningPurpose
│   └── wlo.ts                # Materialien-REST-Client
├── .env.example
├── vercel.json               # Function-Timeouts
└── README.md
```

## Troubleshooting

- **„OPENAI_API_KEY nicht gesetzt"** — Key fehlt in `.env.local` (oder im Vercel-Projekt).
- **`Cannot find module './XXX.js'` im Dev-Server** — Next.js-Cache ist inkonsistent. `rm -rf .next` (Windows: `Remove-Item -Recurse -Force .next`) und `npm run dev` neu starten.
- **Graph bricht mitten in der Generierung ab** — Meist Timeout. Auf Vercel Hobby: `maxDuration` in `vercel.json` reduzieren oder auf Pro upgraden. Lokal: `OPENAI_API_KEY` Limits prüfen.
- **Keine Materialien gefunden** — der externe Materialien-Endpoint kann langsam sein (8 s Timeout). Versuche im Drawer einen generischeren Begriff, oder warte einen Moment und öffne den Drawer erneut.
- **Session-Reload zeigt altes Thema** — im Header auf „Neues Thema" klicken; das löscht den localStorage-Eintrag.

## Lizenz

Dieses Repository enthält den POC-Code; Lizenz siehe übergeordnetes Repo.
