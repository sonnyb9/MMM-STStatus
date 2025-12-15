# MMM-STStatus

A MagicMirror² module that displays the status of your SmartThings devices in a clean, card-style interface.

![Screenshot](screenshots/example.png)

## Features

- **Room-based device selection** - Select devices by room name, not just capability
- **Explicit device list** - Or specify exact devices to display
- **Interactive setup script** - Easy configuration generation
- **Smart caching** - Faster startup and offline resilience
- **Rate limit aware** - Respects SmartThings API limits
- **Test mode** - Development and screenshots without API access
- **Responsive design** - Adapts to different display sizes

## Prerequisites

- [MagicMirror²](https://github.com/MichMich/MagicMirror) version 2.25.0 or later
- Node.js version 18.0.0 or later
- A [SmartThings](https://www.smartthings.com/) account with connected devices
- A SmartThings Personal Access Token (PAT)

## Installation

1. Navigate to your MagicMirror modules folder:
   ```bash
   cd ~/MagicMirror/modules
   ```

2. Clone this repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/MMM-STStatus.git
   ```

3. Install dependencies:
   ```bash
   cd MMM-STStatus
   npm install
   ```

4. Run the setup script (recommended):
   ```bash
   npm run setup
   ```
   
   Or manually configure (see Configuration section below).

## Getting a SmartThings Personal Access Token

1. Go to [https://account.smartthings.com/tokens](https://account.smartthings.com/tokens)
2. Log in with your Samsung account
3. Click **Generate new token**
4. Give it a name (e.g., "MagicMirror")
5. Select the following scopes:
   - `r:devices:*` - Read all devices
   - `r:locations:*` - Read all locations
6. Click **Generate token**
7. Copy the token immediately (it won't be shown again!)

## Configuration

### Using the Setup Script (Recommended)

Run the interactive setup:
```bash
cd ~/MagicMirror/modules/MMM-STStatus
npm run setup
```

The script will guide you through:
1. Validating your PAT
2. Selecting your display position
3. Choosing rooms and devices
4. Setting additional options

Copy the generated configuration block into your `config/config.js`.

### Manual Configuration

Add the following to the `modules` array in your `config/config.js`:

```javascript
{
  module: "MMM-STStatus",
  position: "top_left",
  header: "Smart Home",
  config: {
    token: "YOUR_SMARTTHINGS_PAT",
    rooms: ["Living Room", "Kitchen"],
    // OR use explicit devices:
    // devices: [
    //   { id: "device-uuid-1", name: "Front Door" },
    //   { id: "device-uuid-2", name: "Thermostat" }
    // ],
    pollInterval: 60000,
    showLastUpdated: true,
    temperatureUnit: "F",
    defaultSort: "name",
    debug: false,
    testMode: false
  }
}
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `token` | String | *required* | Your SmartThings Personal Access Token |
| `devices` | Array | `[]` | Explicit list of devices: `[{ id: "uuid", name: "Display Name" }]` |
| `rooms` | Array | `[]` | List of room names to include (e.g., `["Living Room"]`) |
| `pollInterval` | Number | `60000` | How often to fetch updates (in milliseconds, minimum 30000) |
| `showLastUpdated` | Boolean | `true` | Show "Updated: HH:MM" timestamp |
| `temperatureUnit` | String | `"F"` | Temperature unit: `"F"` or `"C"` |
| `defaultSort` | String | `"name"` | Sort devices by: `"name"`, `"room"`, or `"capability"` |
| `debug` | Boolean | `false` | Enable verbose console logging |
| `testMode` | Boolean | `false` | Use mock data (no API calls) |

## Supported Device Types

| Capability | Display | Icon |
|------------|---------|------|
| Switch | ON / OFF | 💡 Lightbulb |
| Contact Sensor | OPEN / CLOSED | 🚪 Door |
| Motion Sensor | MOTION / — | 🚶 Person |
| Lock | LOCKED / UNLOCKED | 🔒 Lock |
| Presence Sensor | HOME / AWAY | 🏠 House |
| Temperature | ##°F/°C | 🌡️ Thermometer |
| Humidity | ##% | 💧 Droplet |
| Battery | ##% | 🔋 Battery |

## Troubleshooting

### "SmartThings authentication failed"

- Your PAT may have expired - generate a new one
- Verify the token has the correct scopes (`r:devices:*`, `r:locations:*`)
- Check for typos in the token

### "No devices found"

- Room names must match exactly (case-sensitive)
- Verify devices are assigned to rooms in the SmartThings app
- Try using `testMode: true` to verify the module is loading

### "Rate limit errors"

- Increase `pollInterval` to 120000 (2 minutes) or higher
- Reduce the number of devices being monitored
- The SmartThings API allows 250 requests per minute

### Module not appearing

- Check the MagicMirror logs: `npm start dev`
- Verify the module is in the correct directory
- Ensure `npm install` completed successfully

### Icons not showing

- Run `npm install` to ensure Font Awesome is installed
- Check browser console for CSS loading errors

## API Rate Limits

SmartThings limits API requests to **250 per minute** per token. This module:

- Tracks request count and warns at 200/minute
- Implements automatic backoff on rate limit errors
- Caches data to reduce unnecessary requests
- Uses a minimum poll interval of 30 seconds

For large installations (20+ devices), consider increasing `pollInterval` to 120000ms or higher.

## Credits

- **MagicMirror²** - [https://magicmirror.builders/](https://magicmirror.builders/)
- **MMM-Smartthings** by buzzkc - Inspiration and prior art ([GitHub](https://github.com/buzzkc/MMM-Smartthings))
- **MMM-Ecobee** - UI design inspiration

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Pull requests are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with `npm run lint`
5. Submit a pull request

## Support

- Open an [issue](../../issues) for bugs or feature requests
- Check existing issues before creating new ones
