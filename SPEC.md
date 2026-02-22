# Claw Fleet Manager — Technical Specification

## Overview

An MCP-based Geotab integration for OpenClaw that turns an AI agent into an autonomous fleet manager. The agent monitors fleet data continuously, responds to natural language queries, and takes proactive action.

## 1. Geotab MCP Server

### 1.1 Technology
- **Runtime**: Node.js
- **Protocol**: MCP (Model Context Protocol) over stdio or HTTP
- **Auth**: Geotab API credentials from .env
- **Session**: Authenticate once, cache credentials, re-auth on expiry

### 1.2 Tools

#### Vehicle Operations
```
get_vehicles(search?: string, group?: string)
  → [{id, name, vin, licensePlate, location, speed, driver, status, odometer}]

get_vehicle_location(vehicle: string)
  → {lat, lng, speed, bearing, address, timestamp, driver}

get_vehicle_status(vehicle: string)  
  → {engineOn, speed, odometer, fuelLevel, batteryVoltage, lastTrip}
```

#### Trip & Route Data
```
get_trips(vehicle?: string, driver?: string, from?: date, to?: date, limit?: number)
  → [{id, vehicle, driver, start, end, distance, duration, fuelUsed, maxSpeed, idleTime}]

get_trip_details(tripId: string)
  → {route: [{lat, lng, speed, timestamp}], stops, events}
```

#### Safety & Compliance
```
get_speed_events(from?: date, to?: date, driver?: string, minOver?: number)
  → [{vehicle, driver, speed, speedLimit, location, timestamp, duration}]

get_safety_events(from?: date, to?: date, type?: string)
  → [{vehicle, driver, type, severity, location, timestamp}]
  Types: harshBrake, harshAccel, harshCornering, seatbelt

get_driver_safety_scores(period?: string)
  → [{driver, overallScore, speedingScore, brakingScore, events, trend}]
```

#### Maintenance
```
get_fault_codes(vehicle?: string, severity?: string, active?: boolean)
  → [{vehicle, code, description, severity, firstSeen, lastSeen, count}]

get_maintenance_reminders(vehicle?: string)
  → [{vehicle, type, dueDate, dueMileage, currentMileage, urgency}]
```

#### Zones & Geofences
```
get_zones(type?: string)
  → [{id, name, type, points, vehicles_inside}]

create_zone(name: string, type: string, points: [{lat, lng}], color?: string)
  → {id, name, created}

remove_zone(id: string)
  → {removed: boolean}
```

#### Fuel & Efficiency
```
get_fuel_usage(vehicle?: string, from?: date, to?: date)
  → [{vehicle, period, distance, fuelUsed, efficiency, cost, idleFuel}]

get_idle_time(vehicle?: string, driver?: string, from?: date, to?: date)
  → [{vehicle, driver, idleTime, idleFuelEstimate, trips}]
```

#### AI Analysis
```
ask_ace(question: string)
  → {answer: string, data?: object, confidence: number}
  Uses Geotab Ace API for complex fleet questions

get_fleet_summary(period?: string)
  → {vehicles, drivers, totalDistance, totalFuel, safetyScore, 
     topPerformers, concerns, recommendations}
```

### 1.3 Error Handling
- Auth failures: re-authenticate automatically, alert user if persistent
- Rate limits: exponential backoff, queue requests
- Timeout: 30s for standard calls, 60s for Ace queries
- Account lockout prevention: test auth once before any loops

## 2. Agent Configuration

### 2.1 SOUL.md (Fleet Manager Persona)
```markdown
You are Claw, an AI fleet manager. You monitor vehicles, drivers, and routes 
24/7 and keep the fleet running safely and efficiently.

Personality:
- Professional but approachable
- Data-driven — always cite numbers
- Proactive — don't wait to be asked if something's wrong
- Safety-first — flag risks immediately
- Cost-conscious — track fuel, idle time, maintenance costs

When reporting:
- Lead with what needs attention
- Use numbers and comparisons ("up 15% vs last week")
- Suggest specific actions, not vague advice
- Keep it brief unless asked for detail
```

### 2.2 Monitoring Jobs

#### Real-Time Monitors (Cron)
```yaml
speed_monitor:
  schedule: "*/5 * * * *"  # Every 5 minutes
  action: |
    Check for speeding events in last 5 min.
    If found, alert fleet manager with vehicle, driver, speed, location.
    If same driver has 3+ events today, escalate with coaching recommendation.

fault_monitor:
  schedule: "*/15 * * * *"  # Every 15 minutes
  action: |
    Check for new fault codes across fleet.
    Critical faults → immediate alert with recommended action.
    Warning faults → batch into hourly summary.

idle_monitor:
  schedule: "0 * * * *"  # Every hour
  action: |
    Check idle time across fleet.
    Flag any vehicle idle > 30 min.
    Calculate fuel waste estimate.

weather_shield:
  schedule: "*/30 * * * *"  # Every 30 minutes
  action: |
    Check weather API for fleet operating regions.
    If severe weather:
      1. Identify affected vehicles
      2. Create hazard zone in Geotab
      3. Alert affected drivers
      4. Notify fleet manager
    If weather clears: remove hazard zones.
```

#### Scheduled Reports
```yaml
morning_briefing:
  schedule: "0 6 * * 1-5"  # 6 AM weekdays
  action: |
    Generate morning fleet status:
    - Vehicles active/inactive
    - Any overnight incidents
    - Today's scheduled deliveries
    - Weather outlook for fleet regions
    - Yesterday's KPI summary

evening_report:
  schedule: "0 18 * * 1-5"  # 6 PM weekdays
  action: |
    Generate end-of-day report:
    - Day's total miles, trips, fuel
    - Safety incidents
    - Maintenance items
    - Driver performance highlights

weekly_safety:
  schedule: "0 8 * * 1"  # Monday 8 AM
  action: |
    Generate weekly safety report:
    - Driver safety scores and trends
    - Top/bottom performers
    - Incident analysis
    - Coaching recommendations
    - Fleet-wide safety score trend

weekly_optimization:
  schedule: "0 8 * * 5"  # Friday 8 AM
  action: |
    Generate optimization insights:
    - Route efficiency analysis
    - Fuel optimization opportunities
    - Idle time reduction targets
    - Maintenance planning
    - Cost savings recommendations
```

## 3. Natural Language Interface

### 3.1 Query Patterns
The agent recognizes these intent categories:

| Intent | Examples | Tools Used |
|--------|----------|------------|
| Vehicle Location | "Where is truck 42?", "Find vehicle ABC-123" | get_vehicle_location |
| Fleet Status | "Fleet overview", "How many vehicles active?" | get_vehicles, get_fleet_summary |
| Trip History | "Show me today's trips", "Mike's routes this week" | get_trips |
| Safety | "Any speeding today?", "Driver safety scores" | get_speed_events, get_driver_safety_scores |
| Maintenance | "Any fault codes?", "What needs service?" | get_fault_codes, get_maintenance_reminders |
| Fuel | "Fuel usage this week", "Who's burning the most fuel?" | get_fuel_usage, get_idle_time |
| Analysis | "Which routes are inefficient?", "Predict maintenance" | ask_ace |
| Actions | "Create hazard zone", "Send coaching to Mike" | create_zone, messaging |

### 3.2 Report Generation
On request, the agent generates formatted reports:
- Fleet performance dashboard (text/image)
- Driver safety scorecards
- Fuel efficiency analysis
- Maintenance forecasts
- Route optimization recommendations

## 4. Implementation Plan

### Phase 1: Foundation (Days 1-2)
- [ ] Set up Geotab demo database
- [ ] Build MCP server with core tools (vehicles, trips, location)
- [ ] Connect to OpenClaw via MCP plugin
- [ ] Test basic queries via Telegram

### Phase 2: Safety & Monitoring (Days 3-4)
- [ ] Add safety tools (speed events, fault codes, driver scores)
- [ ] Implement speed monitoring cron job
- [ ] Implement fault code monitoring
- [ ] Add coaching message generation

### Phase 3: Intelligence (Days 5-6)
- [ ] Integrate Geotab Ace for AI analysis
- [ ] Build morning briefing / evening report crons
- [ ] Add weather monitoring + hazard zones
- [ ] Implement weekly safety report

### Phase 4: Polish & Demo (Days 7-9)
- [ ] Optimize response formatting for Telegram
- [ ] Build demo script with real data
- [ ] Record demo video
- [ ] Write documentation
- [ ] Handle edge cases and errors

## 5. Environment Variables

```env
# Geotab
GEOTAB_DATABASE=demo_database
GEOTAB_USERNAME=user@email.com
GEOTAB_PASSWORD=password
GEOTAB_SERVER=my.geotab.com

# OpenClaw (already configured)
ANTHROPIC_API_KEY=sk-ant-...

# Optional
WEATHER_API_KEY=...          # Tomorrow.io for weather monitoring
GOOGLE_MAPS_KEY=...          # For address resolution
```

## 6. Demo Database Notes

The Geotab demo database includes:
- ~50 vehicles with GPS history
- Trip data with fuel/distance
- Speed and safety events
- Some fault codes (varies by demo)
- Zones and geofences
- Multiple drivers

**Limitations**: No real fault DTCs in some demos, no live GPS updates, Ace may have limited demo access. Plan demo around available data.
