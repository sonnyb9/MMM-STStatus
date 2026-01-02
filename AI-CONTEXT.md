# MMM-STStatus AI Context Document

> **Purpose**: Single source of truth for AI assistants working on this project.  
> **Last Updated**: 2025-12-29 | **Version**: 0.4.3

---

## 1. Project Overview

MMM-STStatus is a MagicMirror² module that displays SmartThings device status. Currently read-only; future roadmap includes optional device control.

**Key characteristics**:
- OAuth 2.0 authentication with auto-refresh
- Encrypted credential storage (not in config.js)
- Intelligent alerts with auto-dismiss
- Multi-language support (5 languages)

---

## 2. Repository & Environment

| Location | Path |
|----------|------|
| GitHub | https://github.com/sonnyb9/MMM-STStatus |
| Local (Windows) | `C:\Users\asonn\dev\MMM-STStatus` |
| Deployed (Pi) | `~/MagicMirror/modules/MMM-STStatus` |
| Pi IP | 192.168.4.236 |

**Runtime**: Node 22.x (targets ≥18), MagicMirror v2.33.0, pm2 process manager

---

## 3. File Structure & Purposes

```
MMM-STStatus/
├── MMM-STStatus.js         # Frontend: DOM rendering, translations, socket handling
├── node_helper.js          # Backend: OAuth, polling, caching, rate-limit, alerts
├── oauth-utils.js          # Encryption helpers for OAuth credentials + tokens
├── setup.js                # CLI wizard for OAuth setup + config generation
├── css/MMM-STStatus.css    # Styling
├── translations/           # i18n (en, de, fr, es, nl)
│   ├── en.json
│   ├── de.json
│   ├── fr.json
│   ├── es.json
│   └── nl.json
├── oauth-key.bin           # Encryption key (gitignored)
├── oauth-data.enc          # Encrypted OAuth data (gitignored)
├── .cache.json             # Runtime cache (gitignored)
├── AI-CONTEXT.md           # This file
├── CHANGELOG.md            # Version history
├── README.md               # User documentation
├── TESTING_GUIDE.md        # Beta tester guide
└── package.json            # Dependencies
```

---

## 4. Current Config Options

All options with their defaults from `MMM-STStatus.js`:

```javascript
defaults: {
  token: "",                    // LEGACY: PAT (deprecated)
  devices: [],                  // Explicit devices: [{ id: "xxx", name: "Name" }]
  rooms: [],                    // Room names: ["Living Room", "Kitchen"]
  pollInterval: 60000,          // Min 30s enforced by backend
  showLastUpdated: true,        // Footer shows clock time
  showDeviceType: true,         // Type column (Lock, Switch, etc.)
  fontSize: 100,                // Font size as percentage (80 = smaller, 120 = larger)
  temperatureUnit: "F",         // "F" or "C"
  defaultSort: "name",          // "name" | "room" | "capability"
  debug: false,
  testMode: false               // Use mock data
}
```

**Note**: OAuth credentials stored in `oauth-data.enc`, NOT in config.js.

---

## 5. Socket Notifications (Frontend ↔ Backend Contract)

### Frontend → Backend

| Notification | Payload | Purpose |
|--------------|---------|---------|
| `SET_CONFIG` | `config` object | Initialize with config |

### Backend → Frontend

| Notification | Payload | Purpose |
|--------------|---------|---------|
| `DEVICE_DATA` | `{ devices, timestamp }` | Device status update |
| `ERROR` | `{ message, cached?, devices?, timestamp? }` | Error with optional cached data |
| `LOADING` | `{}` | Loading state |
| `ALERT` | `{ type, messageKey }` | Trigger footer alert |
| `ALERT_CLEAR` | `{}` | Clear footer alert |

**Device object structure**:
```javascript
{
  id: "device-uuid",
  name: "Front Door",
  room: "Entry",
  primaryCapability: "lock",       // switch|contact|motion|lock|presence|temperature|blinds
  primaryState: "locked",          // varies by capability
  // Optional secondary attributes:
  temperature: 72,
  humidity: 45,
  battery: 85,
  level: 50,                       // for blinds/dimmers
  heatingSetpoint: 68,
  coolingSetpoint: 72,
  capabilities: {
    thermostatOperatingState: "heating"  // heating|cooling|fan only|idle
  }
}
```

---

## 6. Change Impact Matrix

Use this table to identify ALL files that need updating for each type of change:

| Change Type | Files to Update |
|-------------|-----------------|
| **Add config option** | `MMM-STStatus.js` (defaults), `node_helper.js` (read), `README.md`, `AI-CONTEXT.md` |
| **Add device field** | `node_helper.js` (normalizeDevice), `MMM-STStatus.js` (display), `AI-CONTEXT.md` |
| **Add socket notification** | `node_helper.js` (send), `MMM-STStatus.js` (receive), `AI-CONTEXT.md` |
| **Add translation key** | ALL 5 files in `translations/`, `AI-CONTEXT.md` |
| **Add alert type** | `node_helper.js` (ALERT_PRIORITY, recordFailure), `translations/*`, `AI-CONTEXT.md` |
| **Change styling** | `css/MMM-STStatus.css`, possibly `MMM-STStatus.js` (class names) |
| **Add capability support** | `MMM-STStatus.js` (CAPABILITY_ICONS, CAPABILITY_LABELS, STATE_CLASSES), `node_helper.js` (normalizeDevice, capabilityPriority), `translations/*` |
| **Add new feature** | All relevant files + `CHANGELOG.md` |

---

## 7. Key Implementation Patterns

### OAuth Token Refresh
```javascript
// SmartThings requires Basic Auth header for token operations
const basicAuth = Buffer.from(clientId + ":" + clientSecret).toString("base64");
headers: { "Authorization": "Basic " + basicAuth }
```

### Device Resolution Priority
```javascript
// 1. If explicit devices configured → use ONLY those
// 2. If only rooms configured → fetch all devices from those rooms
// Never combine both
```

### Alert System
```javascript
// Priority order (lower index = higher priority):
ALERT_PRIORITY: ["auth", "scope", "network", "rateLimit", "outage", "schema"]

// Immediate alerts: auth, scope
// Threshold alerts (after 10 failures): network, rateLimit, outage, schema
```

### Capability Normalization
```javascript
// Map SmartThings API capability names to internal names
const mapping = {
  "temperatureMeasurement": "temperature",
  "relativeHumidityMeasurement": "humidity",
  "contactSensor": "contact",
  "motionSensor": "motion",
  "presenceSensor": "presence",
  "windowShade": "blinds",
  "windowShadeLevel": "blinds",
  "switchLevel": "level"
};
```

---

## 8. CSS Classes Reference

| Class | Purpose |
|-------|---------|
| `.mmm-ststatus` | Main container |
| `.device-table` | Device table |
| `.device-row` | Table row |
| `.device-icon` | Icon column |
| `.device-name` | Name column |
| `.device-type` | Type column |
| `.device-status` | Primary status column |
| `.device-secondary` | Secondary attributes column |
| `.status-value` | Status text wrapper |
| `.last-updated` | Footer timestamp |
| `.footer-alert` | Footer alert message |

### State Classes (apply to icons and status)
| Class | Color | Usage |
|-------|-------|-------|
| `.state-on` | Green (#4ade80) | Switch on |
| `.state-off` | Grey (#888) | Switch off |
| `.state-open` | Red (#f87171) | Door/window open |
| `.state-closed` | Green (#4ade80) | Door/window closed |
| `.state-locked` | Green (#4ade80) | Lock locked |
| `.state-unlocked` | Red (#f87171) | Lock unlocked |
| `.state-motion` | Blue (#60a5fa) | Motion active |
| `.state-inactive` | Grey (#666) | Motion inactive |
| `.state-home` | Green (#4ade80) | Presence home |
| `.state-away` | Grey (#888) | Presence away |
| `.state-partially` | Yellow (#fbbf24) | Blinds partially open |
| `.state-battery-low` | Yellow (#fbbf24) | Battery <20% |

### Thermostat State Classes
| Class | Color | Usage |
|-------|-------|-------|
| `.thermostat-heating` | Red (#ff4d4d) | Heating active |
| `.thermostat-cooling` | Blue (#4da6ff) | Cooling active |
| `.thermostat-fan-only` | Green (#4dff88) | Fan only |
| `.thermostat-idle` | White (#ffffff) | Idle |

---

## 9. Translation Keys Reference

### UI Strings
```
LOADING, NO_DEVICES, LAST_UPDATE, UNKNOWN_DEVICE
```

### State Labels
```
ON, OFF, OPEN, CLOSED, LOCKED, UNLOCKED, MOTION, HOME, AWAY
HEAT, COOL
```

### Device Type Labels
```
TYPE_SWITCH, TYPE_DOOR_SENSOR, TYPE_MOTION_SENSOR, TYPE_LOCK,
TYPE_PRESENCE, TYPE_THERMOSTAT, TYPE_HUMIDITY, TYPE_BLINDS,
TYPE_DIMMER, TYPE_BATTERY, TYPE_UNKNOWN
```

### Error Messages
```
ERROR_NO_AUTH, ERROR_NO_DEVICES
```

### Alert Messages
```
ALERT_AUTH, ALERT_SCOPE, ALERT_NETWORK, ALERT_RATE_LIMIT,
ALERT_OUTAGE, ALERT_SCHEMA
```

---

## 10. Deployment Workflow

### Development (Windows)
```powershell
cd C:\Users\asonn\dev\MMM-STStatus
# Make changes
git add .
git commit -m "feat: description"
git push origin main
```

### Testing (Raspberry Pi)
```bash
cd ~/MagicMirror/modules/MMM-STStatus
git pull origin main
pm2 restart magicmirror --update-env
pm2 logs magicmirror
```

### Useful mmctl Aliases (Pi)
```bash
mmctl update      # git pull + npm ci + restart
mmctl restart     # verify config + restart + tail logs
mmctl health 50   # health snapshot
mmctl err 200     # errors only
mmctl logs        # full logs
```

---

## 11. Alert System Details

| Alert Type | Trigger | Threshold | Message Key |
|------------|---------|-----------|-------------|
| `auth` | 401 or invalid_grant | Immediate | `ALERT_AUTH` |
| `scope` | 403 Forbidden | Immediate | `ALERT_SCOPE` |
| `network` | ENOTFOUND, ETIMEDOUT, etc. | 10 failures | `ALERT_NETWORK` |
| `rateLimit` | 429 Too Many Requests | 10 failures | `ALERT_RATE_LIMIT` |
| `outage` | 500, 502, 503 | 10 failures | `ALERT_OUTAGE` |
| `schema` | 200 with unexpected response | 10 failures | `ALERT_SCHEMA` |

Alerts auto-dismiss when API returns successfully (`consecutiveFailures` resets to 0).

---

## 12. SmartThings API Notes

- **Rate limit**: 250 requests/minute per token
- **Access tokens**: Expire after 24 hours
- **Refresh tokens**: Expire after 30 days of non-use
- **Basic Auth required**: Token exchange AND refresh require Basic Auth header
- **Capability variations**: Different vendors (Ecobee, Nest, etc.) use different capability structures

---

## 13. User Preferences for AI

- **No inline comments** in code blocks
- **Ask detailed questions** before offering options
- **Don't invent troubleshooting steps** that haven't been proven
- **Test each change** before moving to next feature
- **Update ALL translation files** when adding keys
- **Small commits** with clear subjects

---

## 14. Current Status & Roadmap

**Status**: v0.4.2 - Beta release, feature-complete for read-only status display

**Completed**:
- ✅ Secure credential storage (oauth-key.bin + oauth-data.enc)
- ✅ Intelligent alerts with auto-dismiss
- ✅ Multi-language support (5 languages)
- ✅ Clock time display for Last Update
- ✅ Device type column
- ✅ OAuth token auto-refresh

**Planned**:
- 🔲 Next Update countdown (time until next poll)
- 🔲 Click-to-control (behind feature flag, for touch displays)

---

## 15. Known Issues

- Thermostat support primarily validated against **Ecobee** devices
- Other thermostat vendors may need additional capability normalization
- Temperature sensors from some devices (e.g., Ecobee remote sensors) may not display if capability structure differs

---

## 16. Quick Reference

### Run Setup Wizard
```bash
cd ~/MagicMirror/modules/MMM-STStatus
node setup.js
```

### View Logs
```bash
pm2 logs magicmirror --lines 100
pm2 logs magicmirror | grep -i ststatus
```

### Test Mode (no API)
Set `testMode: true` in config to use mock data.
