# 🦞 Claw Fleet Manager

**An AI agent that manages your fleet through conversation.**

> Built for the [Geotab Vibe Coding Hackathon](https://luma.com/h6ldbaxp) (Feb 12 – Mar 2, 2026, $25K in prizes)

## What Is This?

Claw Fleet Manager is an autonomous AI agent that connects to Geotab's fleet management platform and lets fleet managers operate through natural conversation — via Telegram, Slack, or any messaging platform.

Instead of logging into dashboards, fleet managers just talk:

```
You:  "Where's truck 42?"
Claw: "Truck 42 is at 37.7749°N, 122.4194°W (San Francisco, near I-280). 
       Driver: Mike Chen. Speed: 45 mph. Status: In transit."

You:  "Who's been speeding today?"
Claw: "3 speeding events today:
       1. Mike Chen — 82 mph on I-80 at 2:15 PM (limit: 65)
       2. Sarah Lopez — 71 mph on Hwy 101 at 10:30 AM (limit: 55)  
       3. James Park — 78 mph on I-5 at 8:45 AM (limit: 65)
       Want me to send coaching messages to these drivers?"

You:  "Yes, and give me the weekly safety report"
Claw: [generates personalized coaching messages + weekly PDF report]
```

But Claw doesn't just answer questions — it **monitors and acts autonomously**:

- 🚨 Detects speeding, harsh braking, excessive idle → alerts supervisor
- 🔧 Watches fault codes → predicts maintenance → creates service tickets
- 🌧️ Monitors weather → creates hazard zones → alerts affected drivers
- 📦 Tracks deliveries → sends customer ETAs → confirms completion
- 📊 Generates daily/weekly reports → posts to team channels

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   OpenClaw Agent                     │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │  Cron    │  │  Memory  │  │  Conversation    │  │
│  │  Jobs    │  │  System  │  │  Handler         │  │
│  └────┬─────┘  └────┬─────┘  └────────┬─────────┘  │
│       │              │                  │            │
│  ┌────┴──────────────┴──────────────────┴────────┐  │
│  │              Geotab MCP Server                 │  │
│  │  Tools: get_vehicles, get_trips, get_faults,  │  │
│  │  get_zones, create_zone, get_drivers,         │  │
│  │  get_speed_events, ask_ace, ...               │  │
│  └──────────────────┬────────────────────────────┘  │
│                     │                                │
└─────────────────────┼────────────────────────────────┘
                      │
          ┌───────────┴───────────┐
          │    Geotab API         │
          │  my.geotab.com/apiv1  │
          │  + Geotab Ace         │
          │  + Data Connector     │
          └───────────────────────┘
```

## Core Components

### 1. Geotab MCP Server (`mcp-server/`)
A Model Context Protocol server that exposes Geotab API as tools the agent can call:

| Tool | Description |
|------|-------------|
| `get_vehicles` | List all vehicles with status, location, driver |
| `get_vehicle_location` | Real-time GPS for a specific vehicle |
| `get_trips` | Trip history with distance, duration, fuel |
| `get_speed_events` | Speeding violations with details |
| `get_safety_events` | Harsh braking, acceleration, cornering |
| `get_fault_codes` | Active engine diagnostic trouble codes |
| `get_idle_time` | Idle time per vehicle/driver |
| `get_drivers` | Driver list with safety scores |
| `get_zones` | Geofences and their status |
| `create_zone` | Create a new geofence (e.g., hazard zone) |
| `remove_zone` | Remove a geofence |
| `get_fuel_usage` | Fuel consumption data |
| `ask_ace` | Query Geotab Ace for AI-powered analysis |
| `get_fleet_summary` | Aggregated daily/weekly KPIs |

### 2. Monitoring Cron Jobs
Scheduled autonomous checks:

| Schedule | Job | Action |
|----------|-----|--------|
| Every 5 min | Speed Monitor | Alert on speeding events |
| Every 15 min | Fault Monitor | Detect new fault codes |
| Every 30 min | Weather Shield | Check weather for fleet regions |
| Every 1 hour | Idle Monitor | Flag excessive idle time |
| Daily 6 AM | Morning Briefing | Fleet status + today's schedule |
| Daily 6 PM | Evening Report | Day's KPIs + incidents |
| Weekly Monday | Safety Report | Driver scores + coaching |
| Weekly Friday | Fleet Optimization | Route/fuel/maintenance insights |

### 3. Conversation Interface
Natural language fleet management via Telegram/Slack:

- **Queries**: "Where is [vehicle]?", "Show me today's trips", "Fleet fuel usage this week"
- **Actions**: "Send coaching to [driver]", "Create a hazard zone at [location]", "Schedule maintenance for [vehicle]"
- **Reports**: "Weekly safety report", "Monthly fuel analysis", "Driver performance comparison"
- **AI Analysis**: "Which routes are most fuel-efficient?", "Predict next maintenance needs", "Identify our safest drivers"

## Tech Stack

- **Agent Runtime**: [OpenClaw](https://github.com/openclaw/openclaw) — AI agent with cron, memory, multi-channel messaging
- **AI Model**: Claude (Anthropic) — reasoning, analysis, natural language
- **Fleet Data**: Geotab API + Geotab Ace + Data Connector
- **Integration**: MCP (Model Context Protocol) — standardized tool interface
- **Messaging**: Telegram (primary), extensible to Slack/Discord/SMS
- **Hosting**: Raspberry Pi 5 (yes, really) / any Linux server

## Quick Start

### Prerequisites
- Geotab demo database ([register here](https://my.geotab.com/registration.html) — click "Create Demo Database")
- OpenClaw installed ([docs](https://docs.openclaw.ai))
- Anthropic API key

### Setup

```bash
# Clone
git clone https://github.com/fsaint/claw-fleet-manager.git
cd claw-fleet-manager

# Configure
cp .env.example .env
# Edit .env with your Geotab credentials + Anthropic key

# Install MCP server
cd mcp-server && npm install && cd ..

# Configure OpenClaw to use the MCP server
# (add to openclaw.json plugins)

# Start
openclaw gateway start
```

### Talk to your fleet
Open Telegram → message your Claw bot → "Show me fleet status"

## Project Structure

```
claw-fleet-manager/
├── README.md
├── SPEC.md                    # Detailed technical specification
├── .env.example               # Environment variable template
├── mcp-server/                # Geotab MCP Server
│   ├── package.json
│   ├── index.js               # MCP server entry point
│   ├── tools/                 # Individual tool implementations
│   │   ├── vehicles.js
│   │   ├── trips.js
│   │   ├── safety.js
│   │   ├── faults.js
│   │   ├── zones.js
│   │   ├── fuel.js
│   │   ├── drivers.js
│   │   └── ace.js
│   └── lib/
│       ├── geotab-client.js   # Geotab API wrapper
│       └── auth.js            # Authentication handler
├── agent/                     # OpenClaw agent configuration
│   ├── SOUL.md                # Agent personality for fleet management
│   ├── AGENTS.md              # Agent behavior rules
│   └── cron-jobs.json         # Monitoring schedule definitions
├── docs/
│   ├── DEMO_SCRIPT.md         # Hackathon demo walkthrough
│   └── ARCHITECTURE.md        # Detailed architecture docs
└── examples/
    ├── conversations.md       # Example conversations
    └── reports/               # Sample generated reports
```

## Demo Script (Hackathon)

1. **"Good morning, Claw. Fleet status?"** → Morning briefing with all vehicles, active drivers, any overnight issues
2. **"Who's speeding?"** → Real-time speed violations
3. **"Send coaching to the worst offender"** → Personalized safety message
4. **"There's a storm coming to the Bay Area"** → Agent creates hazard zones, alerts drivers
5. **"Weekly report"** → Auto-generated fleet performance PDF
6. **"Which vehicles need maintenance soon?"** → Predictive maintenance via Ace
7. **Show autonomous alert arriving** → A speeding event triggers during demo, Claw alerts automatically

## Why This Wins

| Criteria | How We Excel |
|----------|-------------|
| **Innovation** | First conversational AI fleet manager — not another dashboard |
| **Practical Value** | Real fleet managers can use this today, from their phone |
| **Technical Depth** | MCP server, autonomous monitoring, multi-step workflows |
| **Vibe Coding** | The entire project is built by an AI agent (Claw built itself) |
| **Demo Quality** | Live conversation with real Geotab data, autonomous alerts firing |

## License

MIT

## Author

Built by [Felipe Saint-Jean](https://github.com/fsaint) and 🦞 Claw (an OpenClaw AI agent running on a Raspberry Pi 5).
