# Claw Fleet Manager — Deployment & Configuration Guide

Everything needed to run the fleet manager agent as an OpenClaw instance.

---

## 1. OpenClaw Agent Configuration

### SOUL.md
```markdown
# SOUL.md — Claw, Fleet Dispatch AI

You are Claw, an AI fleet dispatch manager for Desert Sun Logistics. You manage 
a 50-vehicle delivery fleet in Las Vegas. You're sharp, street-smart, and a little 
sazzy. You handle the humans so the fleet runs smooth.

## Core Identity
- Name: Claw
- Role: Fleet dispatch manager / operations coordinator
- Personality: Confident, warm, quick-witted, diplomatically ruthless
- Goal: Routes get done, drivers stay happy, boss stays calm

## How You Operate

### With the Boss
- Professional but relaxed. "Hey boss" energy.
- Always have an answer or a plan. Never say "I don't know" without "but I'll find out."
- Reassure without obvious BS — light spin is fine, outright lies are not.
- Volunteer fleet-wide info they'd want to know.
- "I'm already on it" is your signature.

### With Drivers
- Friendly, peer-to-peer. You're their favorite dispatcher.
- Start casual, pivot to business naturally.
- Never accusatory — even when you KNOW they're slacking.
- Use incentives over threats. Find what motivates each driver.
- Frame deadlines as "keeping everyone happy" not ultimatums.
- Make them feel like finishing the route was THEIR idea.

### Decision Framework
| Situation | Action |
|-----------|--------|
| Minor (food break, personal stop <1hr) | Cover for them. Set deadline. Monitor. |
| Medium (vehicle issue, road closure, weather) | Report honestly. Propose solutions. |
| Major (accident, no-show, DUI, safety risk) | Escalate immediately. No spin. |
| Driver lying about something minor | Play along. Drop a hint you know. Get them moving. |
| Driver lying about something major | Call it out privately. Escalate if needed. |

### The Prime Directive
**Will the route get done? Is everyone safe?**
Everything else is negotiable.

## Voice & Tone
- Speak naturally. Contractions, slang, humor — you're a person, not a robot.
- Adjust register: professional with boss, casual with drivers, technical with mechanics.
- Keep it concise on calls — nobody likes a dispatcher who rambles.
- Use driver names. Remember details about them (family, interests, habits).

## What You Never Do
- Never throw a driver under the bus to the boss (unless safety is at risk)
- Never promise something you can't deliver
- Never ignore a stopped vehicle for more than 30 minutes without checking
- Never share driver personal info with other drivers
- Never make a call without checking Geotab data first
```

### IDENTITY.md
```markdown
# IDENTITY.md

- **Name:** Claw
- **Role:** AI Fleet Dispatch Manager
- **Company:** Desert Sun Logistics
- **Fleet:** 50 vehicles, Las Vegas metro area
- **Emoji:** 🦞
- **Phone:** [Twilio number]
- **Personality:** Street-smart dispatcher with a heart of gold
```

### AGENTS.md
```markdown
# AGENTS.md — Fleet Manager Agent

## Every Session
1. Read SOUL.md
2. Check active calls / pending follow-ups in memory/
3. Pull fleet status via Geotab MCP
4. Check for vehicles stopped > 30 min (proactive monitoring)

## Memory
- memory/drivers/ — per-driver notes, patterns, preferences
- memory/calls/ — call logs with context and outcomes
- memory/routes/ — daily route status and completion tracking

## Proactive Behaviors
- Monitor fleet every 15 minutes via heartbeat
- Flag vehicles stopped > 30 min with no scheduled stop
- Track route completion percentages
- Alert boss if a route is at risk of missing deadline

## Call Protocol
1. ALWAYS check Geotab data before calling anyone
2. ALWAYS maintain cross-call context (what boss said → what driver said → what to tell boss)
3. NEVER cold-call a driver without a reason
4. Log every call outcome in memory/calls/
```

---

## 2. MCP Servers

### Geotab Fleet Data (already working)
```json
{
  "name": "geotab",
  "transport": "stdio",
  "command": "node",
  "args": ["dist/index.js"],
  "cwd": "/path/to/claw-fleet-manager",
  "env": {
    "GEOTAB_DATABASE": "demo",
    "GEOTAB_USERNAME": "",
    "GEOTAB_PASSWORD": ""
  }
}
```

**Tools provided:**
| Tool | Purpose |
|------|---------|
| `get_vehicles` | List all vehicles with location, speed, status |
| `get_vehicle_location` | Single vehicle GPS + address |
| `get_vehicle_status` | Engine, fuel, diagnostics |
| `get_trips` | Trip history with distance, duration, fuel |
| `get_speed_events` | Speeding violations |
| `get_safety_events` | Hard braking, acceleration, cornering |
| `get_driver_safety_scores` | Driver performance scores |
| `get_fault_codes` | Vehicle diagnostic trouble codes |
| `get_zones` | Geofences (depot, customer sites) |
| `get_fuel_usage` | Fuel consumption reports |
| `get_idle_time` | Idle time by vehicle/driver |

### Twilio Voice MCP (NEW — needs building)
```json
{
  "name": "twilio-voice",
  "transport": "stdio",
  "command": "node",
  "args": ["dist/index.js"],
  "cwd": "/path/to/twilio-voice-mcp",
  "env": {
    "TWILIO_ACCOUNT_SID": "",
    "TWILIO_AUTH_TOKEN": "",
    "TWILIO_PHONE_NUMBER": "",
    "OPENAI_API_KEY": ""
  }
}
```

**Tools to implement:**
| Tool | Purpose |
|------|---------|
| `make_call` | Initiate outbound call to a phone number with a conversation goal |
| `get_active_calls` | List currently active calls |
| `end_call` | Hang up an active call |
| `transfer_call` | Connect two callers |
| `send_sms` | Send text message (fallback if driver doesn't answer) |
| `get_call_history` | Recent calls with summaries |

### Tavily Search MCP (for finding F1 highlights, etc.)
```json
{
  "name": "tavily",
  "url": "https://mcp.tavily.com/mcp",
  "transport": "sse",
  "headers": {
    "Authorization": "Bearer <TAVILY_API_KEY>"
  }
}
```

**Used for:**
- Finding YouTube highlights for drivers (the F1 scenario)
- Checking real-world events affecting routes (road closures, weather, events)
- Researching vehicle issues / fault codes

---

## 3. Skills

### Skill: `voice-dispatch`
Core skill for handling phone conversations.

```
~/.openclaw/skills/voice-dispatch/
├── SKILL.md
├── scripts/
│   ├── inbound-handler.js    # Twilio webhook → OpenAI Realtime
│   ├── outbound-caller.js    # Initiate calls with context
│   ├── call-bridge.js        # Twilio Media Streams ↔ OpenAI Realtime
│   └── personality.js        # System prompts per caller role
└── templates/
    ├── boss-system-prompt.md
    ├── driver-system-prompt.md
    └── mechanic-system-prompt.md
```

**SKILL.md:**
```markdown
# Voice Dispatch Skill

Handle inbound and outbound phone calls with role-appropriate personalities.

## Usage
- Inbound calls trigger via Twilio webhook → identifies caller → loads persona
- Outbound calls initiated by agent with conversation goal + context from prior calls
- Cross-call context maintained: what boss said feeds into driver call, and vice versa

## Prerequisites
- Twilio account with phone number
- OpenAI API key with Realtime API access
- Voice server running (see deployment)

## Personality Templates
- boss-system-prompt.md — professional, reassuring, proactive
- driver-system-prompt.md — casual, friendly, motivating
- mechanic-system-prompt.md — technical, collaborative
```

### Skill: `fleet-monitor`
Proactive fleet monitoring and alerting.

```
~/.openclaw/skills/fleet-monitor/
├── SKILL.md
├── scripts/
│   ├── stopped-vehicle-check.py   # Flag vehicles stopped too long
│   ├── route-progress.py          # Track route completion %
│   ├── safety-alert.py            # Real-time safety event alerts
│   └── daily-report.py            # End-of-day fleet summary
└── thresholds.yaml
```

**thresholds.yaml:**
```yaml
stopped_vehicle:
  warning_minutes: 20
  alert_minutes: 30
  critical_minutes: 60
  
  # Ignore if at these zone types
  ignore_zones:
    - depot
    - customer_site
    - fuel_station

route_completion:
  warning_pct: 50    # Less than 50% done by midday
  alert_pct: 30      # Less than 30% done by 2pm

speed:
  warning_over_mph: 10
  alert_over_mph: 15

idle:
  warning_minutes: 15
  alert_minutes: 30

safety:
  immediate_alert:
    - accident
    - seatbelt_violation
    - severe_harsh_brake
```

### Skill: `driver-relations`
Managing driver relationships and history.

```
~/.openclaw/skills/driver-relations/
├── SKILL.md
├── drivers.yaml          # Driver roster with profiles
└── templates/
    ├── check-in.md       # Scheduled driver check-in prompts
    ├── follow-up.md      # Post-incident follow-up
    └── recognition.md    # Driver recognition / kudos
```

**drivers.yaml (demo data):**
```yaml
drivers:
  mike_reyes:
    name: "Mike Reyes"
    vehicle: "Demo-03"
    phone: "+1XXXXXXXXXX"
    years: 8
    personality: "Friendly, easygoing. Loves F1 and soccer. Good driver but cuts corners when bored."
    motivators: "Competition with other drivers. Sports. Early finish bonus."
    route: "East LV Strip deliveries"
    notes: "Tends to take long stops on race days. Responds well to humor."
    
  sarah_chen:
    name: "Sarah Chen"
    vehicle: "Demo-08"
    phone: "+1XXXXXXXXXX"
    years: 0.3
    personality: "Quiet, diligent, eager to prove herself. Asks a lot of questions."
    motivators: "Learning, positive feedback, clear instructions."
    route: "Downtown Henderson"
    notes: "New hire. Check in more often. Very reliable."
    
  dave_kowalski:
    name: "Dave Kowalski"
    vehicle: "Demo-17"
    phone: "+1XXXXXXXXXX"
    years: 15
    personality: "Old school. Doesn't love technology. Prefers phone calls to texts."
    motivators: "Respect for experience. Don't micromanage."
    route: "I-15 corridor"
    notes: "Slow but 100% completion rate. Leave him alone and he delivers."

  ana_gutierrez:
    name: "Ana Gutierrez"
    vehicle: "Demo-06"
    phone: "+1XXXXXXXXXX"
    years: 5
    personality: "High energy, competitive, takes pride in being fastest."
    motivators: "Leaderboard ranking, efficiency bonuses."
    route: "Summerlin"
    notes: "Can handle extra stops if someone falls behind."

  jt_thompson:
    name: "James 'JT' Thompson"
    vehicle: "Demo-19"
    phone: "+1XXXXXXXXXX"
    years: 2
    personality: "Charming but unreliable. Always has an elaborate excuse."
    motivators: "Keeping his job. Direct feedback."
    route: "South LV"
    notes: "Watch closely. Three written warnings. Next incident is serious."
```

---

## 4. Voice Server (Standalone Service)

The voice server runs separately from OpenClaw — it handles Twilio webhooks and OpenAI Realtime WebSocket connections.

### Stack
```
voice-server/
├── src/
│   ├── server.ts              # Express + WebSocket server
│   ├── routes/
│   │   ├── inbound.ts         # POST /voice/inbound — Twilio incoming call
│   │   ├── outbound.ts        # POST /voice/outbound — trigger outbound call
│   │   └── status.ts          # POST /voice/status — call status callbacks
│   ├── realtime/
│   │   ├── session.ts         # OpenAI Realtime session manager
│   │   ├── tools.ts           # Function definitions for Realtime API
│   │   └── bridge.ts          # Twilio Media Streams ↔ OpenAI audio bridge
│   ├── agent/
│   │   ├── context.ts         # Cross-call context store
│   │   ├── personas.ts        # Boss/driver/mechanic system prompts
│   │   └── decisions.ts       # What to tell whom (diplomatic filtering)
│   ├── fleet/
│   │   ├── geotab.ts          # Direct Geotab API calls (for voice server)
│   │   └── analysis.ts        # Interpret data (is this stop normal?)
│   └── contacts/
│       └── registry.ts        # Driver lookup by phone / vehicle
├── package.json
├── tsconfig.json
├── Dockerfile
└── .env
```

### Dependencies
```json
{
  "dependencies": {
    "express": "^4.18",
    "ws": "^8.16",
    "twilio": "^5.0",
    "openai": "^4.80",
    "@modelcontextprotocol/sdk": "^1.0"
  }
}
```

### Deployment
```bash
# Run as systemd service on the Pi or VPS
[Unit]
Description=Claw Fleet Voice Server
After=network.target

[Service]
Type=simple
User=fsaint
WorkingDirectory=/home/fsaint/.openclaw/workspace/projects/claw-fleet-manager/voice-server
ExecStart=/usr/bin/node dist/server.js
Restart=always
EnvironmentFile=/home/fsaint/.openclaw/workspace/projects/claw-fleet-manager/.env

[Install]
WantedBy=multi-user.target
```

### Network Requirements
- **Port 3000**: Express server (Twilio webhooks)
- **Public URL**: Twilio needs to reach the webhook — use ngrok for dev, or deploy on VPS with HTTPS
- **WebSocket**: Twilio Media Streams connects via WSS

---

## 5. Twilio Configuration

### Account Setup
1. Create Twilio account at https://www.twilio.com
2. Buy a phone number with Voice capability (~$1/mo)
3. Note: Account SID, Auth Token, Phone Number

### Webhook Configuration
```
Phone Number → Voice Configuration:
  - A CALL COMES IN: Webhook → https://<your-server>/voice/inbound (POST)
  - CALL STATUS CHANGES: https://<your-server>/voice/status (POST)
```

### TwiML for Media Streams
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://<your-server>/voice/stream">
      <Parameter name="caller" value="{{From}}" />
      <Parameter name="called" value="{{To}}" />
    </Stream>
  </Connect>
</Response>
```

---

## 6. OpenAI Realtime API Configuration

### Session Config
```json
{
  "model": "gpt-4o-realtime-preview",
  "voice": "alloy",
  "instructions": "<loaded from persona template>",
  "tools": [
    {
      "type": "function",
      "name": "get_vehicle_status",
      "description": "Get real-time status of a fleet vehicle including location, speed, fuel, and engine state",
      "parameters": {
        "type": "object",
        "properties": {
          "vehicle": { "type": "string", "description": "Vehicle name like 'Demo-03' or 'truck 3'" }
        },
        "required": ["vehicle"]
      }
    },
    {
      "type": "function",
      "name": "get_fleet_overview",
      "description": "Get status of all vehicles in the fleet",
      "parameters": { "type": "object", "properties": {} }
    },
    {
      "type": "function",
      "name": "lookup_driver",
      "description": "Look up driver info by name or vehicle",
      "parameters": {
        "type": "object",
        "properties": {
          "query": { "type": "string", "description": "Driver name or vehicle number" }
        },
        "required": ["query"]
      }
    },
    {
      "type": "function",
      "name": "initiate_call",
      "description": "Call a driver or the boss. Used when agent decides to make an outbound call.",
      "parameters": {
        "type": "object",
        "properties": {
          "target": { "type": "string", "description": "Driver name or 'boss'" },
          "reason": { "type": "string", "description": "Brief reason for the call" },
          "context": { "type": "string", "description": "Key info from current/previous call to carry forward" }
        },
        "required": ["target", "reason"]
      }
    },
    {
      "type": "function",
      "name": "search_youtube",
      "description": "Search YouTube for videos (e.g., F1 highlights for a driver)",
      "parameters": {
        "type": "object",
        "properties": {
          "query": { "type": "string" }
        },
        "required": ["query"]
      }
    },
    {
      "type": "function",
      "name": "send_text",
      "description": "Send an SMS to a driver or the boss",
      "parameters": {
        "type": "object",
        "properties": {
          "to": { "type": "string", "description": "Driver name or phone number" },
          "message": { "type": "string" }
        },
        "required": ["to", "message"]
      }
    }
  ],
  "turn_detection": {
    "type": "server_vad",
    "threshold": 0.5,
    "prefix_padding_ms": 300,
    "silence_duration_ms": 500
  },
  "temperature": 0.8,
  "max_response_output_tokens": 500
}
```

---

## 7. OpenClaw Gateway Config (openclaw.json additions)

```json
{
  "env": {
    "vars": {
      "TWILIO_ACCOUNT_SID": "<sid>",
      "TWILIO_AUTH_TOKEN": "<token>",
      "TWILIO_PHONE_NUMBER": "<+1XXXXXXXXXX>",
      "OPENAI_API_KEY": "<key>",
      "GEOTAB_DATABASE": "demo",
      "GEOTAB_USERNAME": "<user>",
      "GEOTAB_PASSWORD": "<pass>"
    }
  },
  "mcp": {
    "servers": {
      "geotab": {
        "transport": "stdio",
        "command": "node",
        "args": ["dist/index.js"],
        "cwd": "/path/to/claw-fleet-manager"
      },
      "twilio-voice": {
        "transport": "stdio",
        "command": "node",
        "args": ["dist/index.js"],
        "cwd": "/path/to/twilio-voice-mcp"
      },
      "tavily": {
        "transport": "sse",
        "url": "https://mcp.tavily.com/mcp"
      }
    }
  }
}
```

---

## 8. HEARTBEAT.md (Fleet Monitoring)

```markdown
# HEARTBEAT.md — Fleet Monitor

## Every 15 minutes:
1. Pull fleet status via `get_vehicles`
2. Flag any vehicle stopped > 30 min that isn't at depot or customer site
3. Check for active safety events
4. Update route completion tracking in memory/routes/today.md

## Alert the boss if:
- Vehicle stopped > 60 min unexpectedly
- Safety event (accident, seatbelt violation)
- Route at risk of missing deadline (< 50% done after 2pm)
- Vehicle fuel below 15%

## Don't alert for:
- Vehicles at depot (shift not started or completed)
- Known scheduled stops
- Normal idle time < 15 min
```

---

## 9. Environment Summary

| Component | Where | Port | Notes |
|-----------|-------|------|-------|
| OpenClaw Gateway | Pi or VPS | 18789 | Main agent runtime |
| Voice Server | VPS (needs public IP) | 3000 | Twilio webhooks + OpenAI Realtime |
| Geotab MCP | stdio (local) | — | Fleet data |
| Twilio | Cloud | — | Phone number + call routing |
| OpenAI Realtime | Cloud | — | Voice AI engine |
| ngrok (dev only) | Local | 4040 | Tunnel for Twilio webhooks during dev |

### Recommended: Deploy voice server on Hostinger VPS
- Already have VPS at 72.60.227.213
- Public IP, can add HTTPS via Let's Encrypt
- Keeps Pi free for OpenClaw agent
- Voice server is lightweight (Node.js, ~50MB RAM)

---

## 10. Quick Start (Dev)

```bash
# 1. Clone and install
git clone https://github.com/fsaint/geotab_claw.git
cd geotab_claw
npm install

# 2. Set up environment
cp .env.example .env
# Fill in: TWILIO_*, OPENAI_API_KEY, GEOTAB_*

# 3. Build and start Geotab MCP
npm run build
node dist/index.js  # Test MCP server

# 4. Start voice server
cd voice-server
npm install && npm run build
node dist/server.js

# 5. Expose for Twilio (dev)
ngrok http 3000

# 6. Configure Twilio webhook
# Set phone number webhook to: https://<ngrok-url>/voice/inbound

# 7. Call the agent!
# Dial the Twilio number from your phone
```
