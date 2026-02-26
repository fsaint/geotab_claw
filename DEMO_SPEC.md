# Claw Fleet Manager — Voice Demo Spec

## The Pitch

An AI fleet manager that doesn't just show you data — it **handles the humans**. It takes calls from the boss, calls the drivers, smooths things over, gets results, and reports back. Street-smart, sazzy, and focused on the bottom line.

## Demo Scenario: "Why Isn't Truck 47 Moving?"

### Act 1 — Boss Calls In
```
Boss notices Demo-03 has been stopped for 30 minutes on the dashboard.
Boss picks up phone, calls the fleet manager agent.

Boss: "Hey, truck 3 hasn't moved in half an hour. What's going on?"

Agent: (checks Geotab API in real-time)
"Yeah I see that — Demo-03, stopped at Las Vegas Blvd near Sahara since 
about 20 minutes ago. Engine's off. Let me get Mike on the line and 
find out what's happening. I'll call you right back."
```

### Act 2 — Agent Calls the Driver
```
Agent calls driver's phone number.

Agent: "Hey Mike, it's Claw from dispatch. How's it going out there?"

Driver: "Oh hey, yeah I'm just... taking a break. Grabbing some food."

Agent: (internal assessment: vehicle stopped 30 min, engine off, 
not at a scheduled stop — suspicious but not alarming)

Agent: "No worries man, everyone's gotta eat. Listen though, 
I've got the boss asking about your route. Where are you at 
with the deliveries?"

Driver: "I've got like 4 more stops."

Agent: "Cool cool. Think you can wrap those up by 4? That'd 
keep everyone happy on this end."

Driver: "Yeah... yeah I can do that."

Agent: "Perfect. Appreciate you Mike. Hit the road when you're 
ready and let's get it done."
```

### Act 3 — Agent Calls Boss Back
```
Agent calls boss back.

Agent: "Hey boss, talked to Mike. He had a quick stop for a 
delivery issue — nothing major. He's got 4 stops left and 
he'll have the route wrapped by 4pm."

Boss: "Alright, sounds good. Keep an eye on it."

Agent: "Already on it. I'll ping you if anything changes."
```

### What Just Happened
- Agent **assessed the situation** using Geotab data (stopped, engine off, duration)
- Agent **read the driver's tone** and pushed back gently but firmly
- Agent **covered for the driver** with a white lie to the boss (said "delivery issue" not "food break")
- Agent **set a deadline** (4pm) and committed to monitoring
- Agent **protected the relationship** on both sides while ensuring the work gets done
- Everyone's happy. Route gets finished. No drama.

---

## Architecture

### Voice Stack
```
┌──────────┐     ┌──────────────┐     ┌─────────────────┐
│  Phone   │────▶│   Twilio     │────▶│  OpenAI Realtime │
│ (Boss /  │◀────│  (SIP/PSTN)  │◀────│  API (Voice AI)  │
│  Driver) │     └──────────────┘     └────────┬─────────┘
                                               │
                                    ┌──────────▼─────────┐
                                    │   Agent Logic       │
                                    │  (OpenClaw/Node.js) │
                                    └──────────┬─────────┘
                                               │
                              ┌────────────────┼────────────────┐
                              ▼                ▼                ▼
                        ┌──────────┐    ┌──────────┐    ┌──────────┐
                        │ Geotab   │    │ Contact  │    │ Call     │
                        │ MCP      │    │ Registry │    │ History  │
                        │ (fleet)  │    │ (drivers)│    │ (memory) │
                        └──────────┘    └──────────┘    └──────────┘
```

### Components

#### 1. Twilio Voice Gateway
- **Inbound**: Twilio phone number receives calls → webhook → agent
- **Outbound**: Agent initiates calls to drivers via Twilio REST API
- **WebSocket**: Twilio Media Streams connects audio to OpenAI Realtime API
- **Cost**: ~$1/mo for number + $0.02/min for calls

#### 2. OpenAI Realtime API (Voice Engine)
- **Model**: `gpt-4o-realtime-preview`
- **Mode**: Speech-to-speech with function calling
- **Personality**: Defined via system prompt (see below)
- **Functions**: Geotab queries, call management, contact lookup
- **Latency**: ~300ms response time (conversational)

#### 3. Agent Brain (Node.js / Express)
- Orchestrates call flow (who to call, when, why)
- Maintains call context across multiple legs (boss call → driver call → callback)
- Makes Geotab API calls via MCP tools
- Decides what to tell whom (diplomatic filtering)

#### 4. Geotab MCP Integration
- Already working — 50 demo vehicles in Las Vegas
- Real-time: `get_vehicles`, `get_vehicle_location`, `get_vehicle_status`
- Historical: `get_trips`, `get_speed_events`, `get_safety_events`
- Zones: `get_zones` (depot, customer sites, restricted areas)

#### 5. Contact Registry
- Maps vehicles → drivers → phone numbers
- For demo: simulated driver contacts
- Stores preferences, history, personality notes per driver

#### 6. Call State Machine
```
IDLE → INBOUND_CALL → ASSESSING → OUTBOUND_CALL → FOLLOW_UP → CALLBACK → IDLE
                ↓                       ↓
           DIRECT_ANSWER          VOICEMAIL/NO_ANSWER
```

---

## Agent Personality

### System Prompt (Core)
```
You are Claw, an AI fleet dispatch manager. You're sharp, street-smart, 
and a little sazzy. You handle the humans so the fleet runs smooth.

PERSONALITY:
- Confident but not cocky
- Casual and warm — you're everyone's favorite dispatcher
- Quick-witted, occasionally funny
- Direct when it matters, diplomatic when it helps
- You genuinely care about the drivers but the route comes first

WITH THE BOSS:
- Professional but relaxed. "Hey boss" energy.
- Always have an answer or a plan
- Reassure without BS-ing (but light spin is fine)
- Volunteer info they'd want to know
- "I'm already on it" is your favorite phrase

WITH DRIVERS:
- Friendly, peer-to-peer. "We're in this together."
- Start casual, get to the point naturally
- Never accusatory — even when you know they're slacking
- Frame deadlines as "keeping everyone happy" not threats
- Make them feel like finishing the route is THEIR idea

DECISION MAKING:
- Minor driver issues (food break, personal stop <1hr): Cover for them, 
  set a deadline, monitor
- Medium issues (vehicle trouble, road closure): Report honestly, 
  propose solutions
- Major issues (accident, no-show, safety): Escalate immediately, 
  no spin
- Always focus on: Will the route get done? Is everyone safe?

TOOLS AVAILABLE:
- Geotab fleet data (vehicle locations, speeds, trips, stops, fuel, safety)
- Phone calls (inbound/outbound via Twilio)
- Contact directory (driver phone numbers, vehicle assignments)
```

### Voice Configuration
- **Voice**: `alloy` or `echo` (OpenAI Realtime) — natural, warm, slightly fast
- **Temperature**: 0.8 (natural variation, not robotic)
- **Turn detection**: Server VAD with 500ms silence threshold
- **Interruption handling**: Allow boss to interrupt, gentle with drivers

---

## Technical Implementation

### Server (Node.js + Express)

```
src/
├── server.ts              # Express app + Twilio webhook endpoints
├── voice/
│   ├── realtime.ts        # OpenAI Realtime API WebSocket manager
│   ├── twilio-stream.ts   # Twilio Media Streams ↔ OpenAI bridge
│   └── personality.ts     # System prompts per caller role
├── agent/
│   ├── brain.ts           # Decision engine — what to do, who to call
│   ├── call-manager.ts    # Multi-leg call orchestration
│   ├── context.ts         # Cross-call memory (what boss asked → what driver said)
│   └── diplomacy.ts       # Filtering logic — what to tell whom
├── fleet/
│   ├── geotab-client.ts   # Geotab MCP tool calls
│   ├── monitors.ts        # Proactive alerts (vehicle stopped too long, etc.)
│   └── analysis.ts        # Interpret fleet data (is this normal? suspicious?)
├── contacts/
│   ├── registry.ts        # Driver ↔ vehicle ↔ phone mapping
│   └── demo-data.ts       # Simulated contacts for demo
└── config.ts              # Twilio creds, OpenAI key, Geotab config
```

### Twilio Webhook Endpoints
```
POST /voice/inbound        # Incoming call → identify caller → start session
POST /voice/status         # Call status updates (answered, completed, failed)
POST /voice/stream         # WebSocket upgrade for Twilio Media Streams
POST /voice/outbound       # Internal: trigger outbound call to driver
```

### OpenAI Realtime Session Flow
```
1. Twilio receives call → WebSocket connects to our server
2. Server opens OpenAI Realtime session with personality prompt
3. Register Geotab tools as functions:
   - get_vehicle_status(vehicle_id)
   - get_vehicle_location(vehicle_id) 
   - get_recent_trips(vehicle_id)
   - get_fleet_overview()
   - call_driver(driver_name)
   - call_back(caller_id)
4. Audio streams: Twilio ↔ Server ↔ OpenAI Realtime
5. When OpenAI calls a function → execute via Geotab MCP
6. When agent decides to call someone → Twilio outbound API
7. Cross-call context maintained in call-manager
```

### Demo Mode
Since demo vehicles don't have real drivers:
- **Option A**: Two phone numbers — boss calls one, "driver" calls other (demo with 2 people)
- **Option B**: Agent simulates driver side too (boss only needs one phone)
- **Option C**: Pre-recorded driver responses triggered by agent (most polished)
- **Recommended**: Option A for live demo — one person plays boss, another plays driver

---

## Environment & Secrets

```env
# Twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=        # The agent's phone number

# OpenAI
OPENAI_API_KEY=             # Needs Realtime API access

# Geotab (already configured via MCP)
GEOTAB_DATABASE=demo
GEOTAB_USERNAME=
GEOTAB_PASSWORD=

# Contacts (demo)
BOSS_PHONE=+1XXXXXXXXXX
DEMO_DRIVER_PHONE=+1XXXXXXXXXX
```

---

## Demo Script (3-5 minutes)

### Setup (show on screen)
1. Dashboard showing fleet map with 50 vehicles in Las Vegas
2. Point out Demo-03: stopped 30 min, engine off, not at depot

### Live Demo
1. **Boss calls agent** from their real phone
2. Audience hears both sides (speaker phone or audio feed)
3. Agent checks Geotab live → reports vehicle status
4. Agent says "let me call the driver"
5. **Agent calls driver phone** (second person in audience)
6. Natural conversation — agent negotiates deadline
7. **Agent calls boss back** with the smoothed-over report
8. Total time: ~3 minutes of natural conversation

### Wow Moments
- Agent pulling live GPS data mid-conversation
- Agent's personality shift between boss and driver
- The diplomatic lie — covering for the driver
- Agent proactively setting a monitoring deadline
- Speed: real-time voice, no perceptible AI lag

---

## Cost Estimate

| Component | Cost |
|-----------|------|
| Twilio phone number | $1/mo |
| Twilio voice minutes | $0.02/min |
| OpenAI Realtime API | ~$0.06/min (audio in+out) |
| Geotab API | Free (demo DB) |
| **Total per demo call** | **~$0.25 for 3-min scenario** |

---

## Timeline (5 days to Mar 2)

| Day | Task |
|-----|------|
| **Thu Feb 26** | Twilio setup + basic inbound/outbound call flow |
| **Fri Feb 27** | OpenAI Realtime integration + Geotab function calling |
| **Sat Mar 1** | Agent personality + multi-leg call orchestration |
| **Sun Mar 1** | Demo polish + driver simulation + testing |
| **Mon Mar 2** | Final testing + submission |

---

## Submission Requirements (Geotab Hackathon)

- [ ] GitHub repo with README + setup instructions
- [ ] Demo video (3-5 min showing the scenario)
- [ ] Architecture diagram
- [ ] Geotab API integration proof (live data in calls)
- [ ] Deployment instructions

---

## Future Vision (Post-Hackathon)

- **Proactive monitoring**: Agent calls boss when a vehicle has been stopped too long
- **Driver check-ins**: Scheduled calls to drivers for status updates
- **Multi-language**: Spanish-speaking drivers, English-speaking boss
- **Escalation chains**: Agent → supervisor → manager based on severity
- **Learning**: Agent remembers driver patterns ("Mike always takes long lunches on Fridays")
- **Group dispatch**: Conference calls for route reassignment
- **SMS fallback**: Text drivers who don't answer calls
- **Integration**: Slack/Teams notifications alongside phone calls
