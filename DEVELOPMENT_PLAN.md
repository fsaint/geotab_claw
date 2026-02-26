# Development Plan — Claw Fleet Manager

**Deadline: March 2, 2026 (Geotab Vibe Coding Hackathon)**  
**Prize: $25,000**

---

## Day-by-Day Build Schedule

### Day 1 — Thursday Feb 26: Voice Foundation
**Goal: Make and receive a phone call with an AI voice**

- [ ] Create Twilio account, buy phone number
- [ ] Scaffold `voice-server/` (Express + TypeScript)
- [ ] Implement Twilio inbound webhook (`POST /voice/inbound`)
- [ ] Implement Twilio Media Streams WebSocket handler
- [ ] Connect Twilio audio stream ↔ OpenAI Realtime API
- [ ] Basic system prompt — agent answers the phone, says hello
- [ ] Test: call the number, have a basic conversation
- [ ] Deploy voice server on Hostinger VPS (72.60.227.213)
- [ ] Set up HTTPS via Let's Encrypt (Twilio requires it for webhooks)

**Milestone: Call the Twilio number → AI answers → natural conversation works**

### Day 2 — Friday Feb 27: Geotab + Function Calling
**Goal: Agent can pull live fleet data mid-conversation**

- [ ] Register OpenAI Realtime tools (get_vehicle_status, get_fleet_overview, lookup_driver)
- [ ] Wire tool calls to Geotab MCP server (or direct Geotab API from voice server)
- [ ] Implement caller identification (boss phone → boss persona, unknown → generic)
- [ ] Implement driver contact registry (`drivers.yaml` → phone lookup)
- [ ] Test: "What's going on with truck 3?" → agent checks Geotab → responds with live data
- [ ] Test: "How's the fleet looking?" → agent pulls all vehicles → summarizes

**Milestone: Agent answers phone, pulls live Geotab data, responds naturally**

### Day 3 — Saturday Mar 1: Multi-Call Orchestration
**Goal: Agent can make outbound calls and carry context across calls**

- [ ] Implement outbound call initiation via Twilio REST API
- [ ] Build cross-call context store (what boss said → feeds into driver call)
- [ ] Implement `initiate_call` tool for OpenAI Realtime (agent decides to call someone)
- [ ] Implement callback flow (agent calls boss back after talking to driver)
- [ ] Build diplomatic filtering logic (what to tell boss vs. what driver actually said)
- [ ] Implement personality switching (boss persona ↔ driver persona)
- [ ] Wire up Tavily search tool (find YouTube highlights, check events)
- [ ] Implement `send_text` tool (SMS fallback)
- [ ] Test full F1 scenario: boss calls → agent checks data → agent calls driver → agent calls boss back

**Milestone: Full 3-call demo scenario works end-to-end**

### Day 4 — Sunday Mar 1: Polish & Demo Video
**Goal: Demo-ready, video recorded**

- [ ] Fine-tune voice personality (tone, pacing, temperature)
- [ ] Fine-tune turn detection (silence threshold, interruption handling)
- [ ] Add personality details for each driver (Mike's F1 interest, JT's excuses, etc.)
- [ ] Handle edge cases: voicemail, no answer, driver hangs up, bad connection
- [ ] Build fleet monitoring heartbeat (proactive alerts)
- [ ] Create demo script with timing cues
- [ ] Record demo video (screen + audio capture)
  - Show dashboard with fleet map
  - Boss calls agent (speaker phone)
  - Agent queries Geotab live (show API calls on screen)
  - Agent calls driver (second phone)
  - Agent calls boss back
  - ~3-5 minutes total
- [ ] Write README with setup instructions + architecture diagram

**Milestone: Polished demo video recorded and ready**

### Day 5 — Monday Mar 2: Submit
**Goal: Submission package complete**

- [ ] Final testing — run through scenario 3x
- [ ] Clean up code, add comments
- [ ] Update README with:
  - Architecture diagram
  - Setup instructions
  - Cost breakdown
  - Demo video link
- [ ] Push final code to GitHub
- [ ] Submit to Geotab hackathon

**Milestone: Submitted ✅**

---

## Architecture Overview

```
                    ┌─────────────┐
                    │   Boss's    │
                    │   Phone     │
                    └──────┬──────┘
                           │ PSTN
                    ┌──────▼──────┐
                    │   Twilio    │
                    │  (Voice)   │
                    └──────┬──────┘
                           │ WebSocket (Media Streams)
                    ┌──────▼──────┐
                    │   Voice     │
                    │   Server    │◄──── Express + WS (Hostinger VPS)
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
       ┌────────────┐ ┌────────┐ ┌──────────┐
       │  OpenAI    │ │ Geotab │ │ Tavily   │
       │  Realtime  │ │  API   │ │ Search   │
       │  (Voice)   │ │(Fleet) │ │(YouTube) │
       └────────────┘ └────────┘ └──────────┘
              │
              ▼
       ┌────────────┐
       │  Driver's  │
       │   Phone    │ (outbound via Twilio)
       └────────────┘
```

## Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Voice AI | OpenAI Realtime API (`gpt-4o-realtime-preview`) | Speech-to-speech with function calling |
| Telephony | Twilio Voice + Media Streams | Make/receive real phone calls |
| Fleet Data | Geotab API (demo DB, 50 vehicles) | Real-time vehicle tracking |
| Web Search | Tavily API | Find YouTube highlights, check events |
| Server | Node.js + Express + TypeScript | Webhook handling, call orchestration |
| Hosting | Hostinger VPS (Ubuntu, 8GB RAM) | Public IP for Twilio webhooks |
| HTTPS | Let's Encrypt + Caddy/nginx | Required by Twilio |

## Cost Per Demo Run

| Item | Cost |
|------|------|
| Twilio phone number | $1.00/mo |
| Twilio voice (3 calls × 1 min) | $0.06 |
| OpenAI Realtime (~3 min audio) | $0.18 |
| Geotab API | Free (demo) |
| Tavily search | Free tier |
| **Total per demo** | **~$0.25** |

---

## Prerequisites (Boss Needs To Do)

- [ ] **Twilio account** — sign up at twilio.com, buy a phone number
- [ ] **OpenAI API key** — needs Realtime API access (should already have it)
- [ ] **Hostinger VPS HTTPS** — Claw will set up Caddy + Let's Encrypt

---

## Repo Structure (Target)

```
geotab_claw/
├── README.md                 # Setup + demo instructions
├── SPEC.md                   # Technical spec (MCP tools)
├── DEMO_SPEC.md              # Voice demo architecture
├── DEMO_SCENARIO.md          # F1 race scenario script
├── DEPLOYMENT.md             # Full config guide (SOUL, MCP, skills)
├── DEVELOPMENT_PLAN.md       # This file
├── src/                      # Geotab MCP server
│   └── index.ts
├── voice-server/             # Voice call handler
│   ├── src/
│   │   ├── server.ts         # Express + WebSocket
│   │   ├── routes/
│   │   │   ├── inbound.ts    # Twilio incoming call webhook
│   │   │   ├── outbound.ts   # Trigger outbound calls
│   │   │   └── status.ts     # Call status callbacks
│   │   ├── realtime/
│   │   │   ├── session.ts    # OpenAI Realtime session manager
│   │   │   ├── tools.ts      # Function definitions
│   │   │   └── bridge.ts     # Audio bridge (Twilio ↔ OpenAI)
│   │   ├── agent/
│   │   │   ├── context.ts    # Cross-call memory
│   │   │   ├── personas.ts   # Boss/driver system prompts
│   │   │   └── decisions.ts  # Diplomatic filtering
│   │   ├── fleet/
│   │   │   └── geotab.ts     # Geotab API client
│   │   └── contacts/
│   │       ├── registry.ts   # Driver ↔ vehicle ↔ phone mapping
│   │       └── drivers.yaml  # Demo driver profiles
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
├── demo/
│   ├── video/                # Demo video
│   └── screenshots/          # Dashboard screenshots
├── dist/                     # Compiled JS
├── package.json
└── tsconfig.json
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| OpenAI Realtime API latency | Test early (Day 1). Fallback: use Whisper STT + GPT-4o + ElevenLabs TTS pipeline |
| Twilio webhook issues | Use ngrok for local dev, Caddy on VPS for prod |
| Geotab demo DB limited data | Fake driver roster. Real vehicle data is enough. |
| Time crunch (5 days) | Day 1-2 are core. Day 3 is the demo scenario. Day 4-5 are polish. Minimum viable: 2-call flow (skip callback). |
| Audio quality | Twilio µ-law 8kHz is narrow. OpenAI Realtime handles it natively. Test with real phones, not just browser. |
| Cross-call context bugs | Keep it simple: JSON context object passed between calls. No complex state machine. |

## Minimum Viable Demo (If Behind Schedule)

If we can't finish multi-call orchestration by Day 3:

1. **MVP**: Boss calls agent → agent checks Geotab → agent responds with live data + plan
2. **Skip**: Outbound call to driver (narrate what agent would say instead)
3. **Skip**: Callback to boss (just end with "I'll call Mike and get back to you")

This still shows: real-time voice AI + live fleet data + personality. The multi-call is the wow factor but the single-call is still impressive.
