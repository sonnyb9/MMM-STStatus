# MMM-STStatus

A MagicMirror² module that displays the status of your SmartThings devices in a clean, card-style interface.

![Screenshot](screenshots/example.png)

## Features

- **OAuth authentication** with automatic token refresh (24-hour token expiration handled automatically)
- **Interactive setup wizard** - Complete guided configuration in one command
- **Room-based device selection** - Select devices by room or pick individual devices
- **Intelligent alerts** - Footer alerts for API issues with auto-dismiss on recovery
- **Smart caching** - Faster startup and offline resilience
- **Rate limit aware** - Respects SmartThings API limits with automatic backoff
- **Multi-language support** - English, German, French, Spanish, Dutch
- **Test mode** - Development and screenshots without API access

## Prerequisites

- [MagicMirror²](https://github.com/MagicMirrorOrg/MagicMirror) version 2.25.0 or later
- Node.js version 18.0.0 or later
- A [SmartThings](https://www.smartthings.com/) account with connected devices
- SmartThings CLI (for creating OAuth app)

## Installation

### Step 1: Install the Module

```bash
cd ~/MagicMirror/modules
git clone https://github.com/sonnyb9/MMM-STStatus.git
cd MMM-STStatus
npm install
```

### Step 2: Install the SmartThings CLI

Download and install the SmartThings CLI from:
https://github.com/SmartThingsCommunity/smartthings-cli/releases

- **Windows**: Download and run the `.msi` installer
- **macOS**: `brew install smartthingscommunity/smartthings/smartthings`
- **Linux**: Download the appropriate binary from releases

Verify installation:
```bash
smartthings --version
```

### Step 3: Log into the CLI

Run any command to trigger the login flow:
```bash
smartthings devices
```

A browser window will open - log in with your Samsung account.

### Step 4: Create an OAuth App

Run:
```bash
smartthings apps:create
```

When prompted, enter:
- **App type**: OAuth-In App
- **Display name**: `MMM-STStatus`
- **Description**: `MagicMirror SmartThings Status Display`
- **Icon image URL**: (leave blank, press Enter)
- **Target URL**: (leave blank, press Enter)
- **Scopes**: Select these permissions:
  - `r:devices:*` (read devices)
  - `x:devices:*` (execute device commands)
  - `r:locations:*` (read locations)
- **Redirect URIs**: `https://httpbin.org/get`

**Important**: Save the `OAuth Client Id` and `OAuth Client Secret` displayed at the end. You won't be able to see the secret again!

### Step 5: Run the Setup Wizard

```bash
cd ~/MagicMirror/modules/MMM-STStatus
node setup.js
```

The setup wizard will guide you through:
1. **OAuth authentication** - Enter your Client ID and Secret, authorize in browser
2. **Position selection** - Choose where the module appears on your mirror
3. **Location selection** - Pick your SmartThings location (if you have multiple)
4. **Room selection** - Choose which rooms to include
5. **Device selection** - Pick specific devices or include all from selected rooms
6. **Display options** - Configure polling interval, temperature units, etc.
7. **Config generation** - Produces a ready-to-paste configuration block

### Step 6: Update Your Config

Copy the generated configuration block into your `~/MagicMirror/config/config.js` file in the `modules` array.

Example output from setup wizard:
```javascript
{
  module: "MMM-STStatus",
  position: "top_right",
  header: "Smart Home",
  config: {
    devices: [
      { id: "device-uuid-1", name: "Front Door" },
      { id: "device-uuid-2", name: "Living Room Lamp" }
    ],
    pollInterval: 60000,
    showLastUpdated: true,
    temperatureUnit: "F",
    defaultSort: "name",
    debug: false,
    testMode: false
  }
}
```

**Note:** OAuth credentials (clientId, clientSecret) are stored encrypted in `oauth-data.enc`, not in config.js.

### Step 7: Restart MagicMirror

```bash
pm2 restart MagicMirror
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `devices` | Array | `[]` | Explicit list of devices: `[{ id: "uuid", name: "Display Name" }]` |
| `rooms` | Array | `[]` | List of room names to include (e.g., `["Living Room"]`) |
| `pollInterval` | Number | `60000` | How often to fetch updates (ms, minimum 30000) |
| `showLastUpdated` | Boolean | `true` | Show clock time of last successful API update (e.g., "Last Update: 10:30:45 AM") |
| `showDeviceType` | Boolean | `true` | Show device type column (e.g., "Lock", "Door Sensor") |
| `temperatureUnit` | String | `"F"` | Temperature unit: `"F"` or `"C"` |
| `defaultSort` | String | `"name"` | Sort by: `"name"`, `"room"`, or `"capability"` |
| `debug` | Boolean | `false` | Enable verbose console logging |
| `testMode` | Boolean | `false` | Use mock data (no API calls) |
| `token` | String | `""` | *Legacy:* Personal Access Token (deprecated, use setup.js instead) |

**Note**: Use either `devices` (explicit list) or `rooms` (fetch all devices from rooms), not both.

## Supported Device Types

| Capability | Display | Icon (Font Awesome) |
|------------|---------|---------------------|
| Switch | ON / OFF | `fa-lightbulb` |
| Contact Sensor | OPEN / CLOSED | `fa-door-open` / `fa-door-closed` |
| Motion Sensor | MOTION / — | `fa-person-walking` / `fa-person` |
| Lock | LOCKED / UNLOCKED | `fa-lock` / `fa-lock-open` |
| Presence Sensor | HOME / AWAY | `fa-house-user` / `fa-house` |
| Temperature | ##°F/°C | `fa-thermometer-half` |
| Humidity | ##% | `fa-droplet` |
| Battery | ##% | `fa-battery-full` / `fa-battery-half` / `fa-battery-quarter` |
| Window Shade/Blinds | ##% | `fa-window-maximize` |
| Dimmer | ##% | `fa-sliders` |

### Thermostat Features

For thermostats (like Ecobee), the module displays:
- Current temperature (primary value)
- Humidity (secondary column)
- Heating/cooling setpoints (secondary column)
- Color-coded temperature based on operating state:
  - **Red**: Heating
  - **Blue**: Cooling
  - **Green**: Fan only
  - **White**: Idle

## Translations

The module supports multiple languages. Set the `language` option in your MagicMirror `config.js`:

```javascript
language: "de",  // German
```

**Supported languages:**
- `en` - English (default)
- `de` - German (Deutsch)
- `fr` - French (Français)
- `es` - Spanish (Español)
- `nl` - Dutch (Nederlands)

Contributions for additional languages are welcome! See the `translations/` folder.

## Troubleshooting

The module displays alerts in the footer when issues occur. Alerts auto-dismiss when the problem resolves.

### Footer Alerts

| Alert | Meaning | Solution |
|-------|---------|----------|
| "Auth failed - run setup.js" | OAuth tokens invalid or expired | Re-run `node setup.js` |
| "Permission denied - check OAuth scopes" | Missing API permissions | Recreate OAuth app with correct scopes |
| "Network error - check connection" | Cannot reach SmartThings API | Check internet connection |
| "Rate limited - increase pollInterval" | Too many API requests | Set `pollInterval` to 120000 or higher |
| "SmartThings unavailable - retrying" | SmartThings API is down | Wait for SmartThings to recover |
| "API error - please open GitHub issue" | Unexpected API response format | [Open an issue](https://github.com/sonnyb9/MMM-STStatus/issues) with debug logs |

### Setup Issues

#### "403 Forbidden" when visiting authorization URL
The redirect URI in your SmartThings app doesn't match. Update it:
```bash
smartthings apps:oauth:update YOUR_APP_ID
```
Set redirect URI to: `https://httpbin.org/get`

#### "Empty response from server (HTTP 401)" during token exchange
Authorization codes expire within a few minutes. Run `node setup.js` again and complete the browser authorization promptly.

#### "OAuth tokens not found" when starting module
Run `node setup.js` to complete OAuth setup. Verify `oauth-data.enc` and `oauth-key.bin` exist in the module directory.

#### "OAuth refresh token invalid"
Refresh tokens expire after 30 days of non-use. Re-run `node setup.js` to get new tokens.

### Runtime Issues

#### "No devices found"
- Room names are case-sensitive and must match exactly
- Verify devices are assigned to rooms in the SmartThings app
- Run setup wizard again to see available rooms/devices

#### "Rate limit errors"
- Increase `pollInterval` to 120000 (2 minutes) or higher
- SmartThings allows 250 requests per minute

#### Module not appearing
- Check logs: `pm2 logs MagicMirror`
- Verify syntax in config.js (missing commas are common)
- Ensure `npm install` completed successfully

#### Icons not showing
- Run `npm install` to ensure Font Awesome is installed
- Check browser console for CSS loading errors

## API Rate Limits

SmartThings limits API requests to **250 per minute** per token. This module:

- Tracks request count and warns at 200/minute
- Implements automatic backoff on rate limit errors
- Caches data to reduce unnecessary requests
- Uses a minimum poll interval of 30 seconds

For large installations (20+ devices), increase `pollInterval` to 120000ms or higher.

## Security Notes

- OAuth credentials and tokens are stored in `oauth-data.enc` (encrypted with AES-256-GCM)
- The encryption key is stored separately in `oauth-key.bin` (random 32 bytes)
- **Credentials are NOT stored in config.js** - they're fully encrypted
- Both `oauth-key.bin` and `oauth-data.enc` are gitignored by default
- If copying to a new Pi, copy both files together (they're paired)
- Never commit OAuth files to version control

## File Structure

```
MMM-STStatus/
├── MMM-STStatus.js        # Frontend module
├── node_helper.js         # Backend helper (API, OAuth, caching)
├── setup.js               # Interactive setup wizard
├── oauth-utils.js         # Token encryption utilities
├── oauth-key.bin          # Encryption key (created by setup, gitignored)
├── oauth-data.enc         # Encrypted OAuth data (created by setup, gitignored)
├── css/
│   └── MMM-STStatus.css   # Styles
├── translations/          # Language files
│   ├── en.json            # English
│   ├── de.json            # German
│   ├── fr.json            # French
│   ├── es.json            # Spanish
│   └── nl.json            # Dutch
├── package.json
├── README.md
└── .cache.json            # Device cache (auto-generated)
```

## Credits

- **MagicMirror²** - [https://magicmirror.builders/](https://magicmirror.builders/)
- **MMM-Smartthings** by buzzkc - Inspiration and prior art ([GitHub](https://github.com/buzzkc/MMM-Smartthings))
- **MMM-Ecobee** by parnic - UI design inspiration ([GitHub](https://github.com/parnic/MMM-Ecobee))
- **SmartThings Community** - OAuth implementation guidance

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Pull requests are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## Support

- Open an [issue](https://github.com/sonnyb9/MMM-STStatus/issues) for bugs or feature requests
- Check existing issues before creating new ones
