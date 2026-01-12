# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.4.0-beta.1] – 2025-12-19

### Notes
- First public beta release
- Feature-complete for initial external testing
- Not yet broadly tested across different SmartThings environments
- Feedback requested on:
  - OAuth setup flow
  - API reliability and alert behavior
  - Device normalization across vendors
  - Rendering across MagicMirror positions

---

## [0.4.4] – 2026-01-12

### Fixed
- **Multi-instance filtering** - Frontend now filters devices based on `config.devices` array
  - Fixes issue where multiple MagicMirror instances sharing the same module would show all devices
  - Each instance now correctly displays only its configured devices

---

## [0.4.3] – 2025-12-29

### Added
- **Font size setting** - New `fontSize` config option (percentage, default 100)
  - Set `fontSize: 80` for smaller text, `fontSize: 120` for larger
  - Scales all text: device names, types, status, secondary info, footer

---

## [0.4.2] – 2025-12-28

### Fixed
- **OAuth token refresh failing with HTTP 401** - Added Basic Auth header to token refresh request, matching SmartThings API requirements. Tokens now auto-refresh correctly every 20 hours.

---

## [0.4.1] – 2025-12-21

### Added
- **Device type column** - Shows friendly device type labels (e.g., "Lock", "Door Sensor", "Switch")
  - Helps differentiate devices with similar names (e.g., "Front Door" lock vs sensor)
  - Configurable via `showDeviceType: true/false` (default: true)
  - Translated labels in all 5 supported languages
  - Hidden on narrow displays (<400px) for responsiveness

---

## [0.4.0] – 2025-12-21

### Added
- **Intelligent footer alerts** for API issues with auto-dismiss on recovery
  - Auth failures (401/invalid_grant) - alert immediately
  - Permission errors (403) - alert immediately  
  - Network errors - alert after 10 consecutive failures
  - Rate limiting (429) - alert after 10 consecutive failures
  - API outage (500/502/503) - alert after 10 consecutive failures
  - Schema errors (unexpected API response) - alert after 10 consecutive failures
- Alert messages in all 5 supported languages
- Yellow/amber styling for alert visibility
- Alerts replace "Last Update" footer when active, return when resolved
- **Secure credential storage** - clientId/clientSecret now stored encrypted, not in config.js
  - `oauth-key.bin` - random 32-byte encryption key
  - `oauth-data.enc` - AES-256-GCM encrypted OAuth credentials and tokens

### Changed
- **Merged setup scripts** - Combined `oauth-setup.js` and `setup.js` into single interactive wizard
- Setup wizard now handles complete configuration: OAuth, position, rooms, devices, and options
- **Config.js no longer contains secrets** - only display options like pollInterval, temperatureUnit, etc.
- Removed PAT (Personal Access Token) support from documentation (24-hour expiration made it impractical)
- Updated TESTING_GUIDE.md for beta testers (removed VM testing, updated for OAuth-only)
- Simplified README installation instructions
- **Last update display** shows clock time of last successful API update (e.g., "Last Update: 10:30:45 AM")
- Setup wizard prompts now reference README.md for CLI installation details
- Setup wizard warns that authorization URL expires quickly

### Removed
- `oauth-setup.js` - functionality merged into `setup.js`
- `oauth-tokens.enc` - replaced by `oauth-data.enc` (new format includes credentials)
- clientId/clientSecret from config.js (now stored encrypted)
- PAT authentication documentation (OAuth is now the only supported method)
- VM testing instructions from TESTING_GUIDE.md

---

## [0.3.1] – 2025-12-18

### Added
- **Multi-language support** with translations for 5 languages
  - English (en) - default
  - German (de)
  - French (fr)
  - Spanish (es)
  - Dutch (nl)
- `getTranslations()` method for MagicMirror i18n integration
- Translation files in `translations/` folder

### Changed
- All user-facing strings now use MagicMirror's translation system
- README updated with Translations section and corrected icon names
- Credits section updated with GitHub link for MMM-Ecobee

---

## [0.3.0] – 2025-12-18

### Added
- **OAuth 2.0 authentication** with automatic token refresh (recommended over PAT)
- Interactive `oauth-setup.js` script for credential setup
- AES-256-GCM encryption for secure token storage (`oauth-tokens.enc`)
- Support for both OAuth (`clientId`/`clientSecret`) and legacy PAT (`token`) authentication
- Detailed OAuth setup instructions in README
- Tokens refresh automatically every 20 hours (before 24-hour expiration)
- Encrypted token files can be safely synced via cloud storage (iCloud, etc.)

### Fixed
- Token exchange now uses Basic Auth header (required by SmartThings API)
- Frontend validation now accepts OAuth credentials (`clientId`/`clientSecret`)
- Updated redirect URI to `httpbin.org/get` for reliable authorization code capture

### Changed
- README significantly updated with OAuth setup guide and troubleshooting
- Moved PAT authentication to "legacy" status in documentation

---

## [0.2.0] – 2025-12-17

### Added
- Thermostat **heating and cooling setpoint display** as secondary status indicators.
  - Displays both setpoints when available (e.g., auto mode).
  - Displays a single setpoint when only heating or cooling is supported.
- Capability-based **thermostat operating state styling** (vendor-agnostic).
  - Supports heating, cooling, fan-only, and idle states.
- Improved SmartThings capability parsing to support multiple thermostat schemas.
- Window-style icon for blinds using Font Awesome Free.

### Fixed
- Primary status rendering bug that caused `[object Object]` to display for many devices.
- Blinds now correctly display **percentage open** instead of action labels.
- SmartThings thermostat operating state detection across differing API structures.
- Authentication handling to prevent repeated polling after HTTP 401/403 errors.
- Polling lifecycle issues that caused unnecessary API calls and performance degradation.
- SSH responsiveness degradation caused by runaway polling and repeated authentication failures.

### Changed
- Refactored primary status handling to consistently return normalized display values.
- Improved separation between primary state, secondary attributes, and styling rules.
- Updated blinds icon mapping for better visual clarity.

### Internal
- Hardened node helper logic to stop polling after authentication failure.
- Improved normalization of SmartThings device capabilities for extensibility.
- Frontend logic structured to support future device types (e.g., additional thermostats).

---

## [0.1.0] – 2025-12-12

### Added
- Initial release
- Room-based device selection
- Explicit device list support
- Interactive setup script (`npm run setup`)
- Support for common SmartThings capabilities:
  - Switch (on/off)
  - Contact sensor (open/closed)
  - Motion sensor (active/inactive)
  - Lock (locked/unlocked)
  - Presence sensor (home/away)
  - Temperature measurement
  - Humidity measurement
  - Battery level
- Device status display with Font Awesome icons
- Color-coded status indicators
- Secondary attributes display (battery, temperature)
- Configurable temperature unit (F/C)
- Configurable device sorting
- Caching for offline resilience and faster startup
- Rate limiting to respect SmartThings API limits
- Test mode for development without API access
- Debug logging option
- Responsive CSS for different display sizes

---

## Known Issues

### Device Coverage
- Thermostat support has been validated primarily against **Ecobee** devices.
- Other thermostat vendors (e.g., Nest, Honeywell) have not been tested and may require additional capability normalization.

### UI / UX
- Battery warning thresholds are currently hardcoded (20% low, 60% medium).
- No user-configurable battery warning levels yet.

### SmartThings API
- The SmartThings cloud API occasionally experiences intermittent failures or slow responses outside the control of this module.
- Device status updates may be delayed 30–60 seconds depending on SmartThings backend performance.
