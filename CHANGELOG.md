# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

## Known Issues

### SmartThings Authentication (PAT)
- The module currently relies on **SmartThings Personal Access Tokens (PATs)**.
- PATs expire after **24 hours**, which can cause:
  - Repeated HTTP 401/403 errors
  - Polling loops and excessive API requests
  - Degraded MagicMirror performance and SSH responsiveness

### OAuth Migration (Planned)
- Migration to **SmartThings OAuth authentication** is planned to address:
  - Token expiration handling
  - Automatic token refresh
  - Improved long-term reliability
- OAuth is not yet implemented.

### Device Coverage
- Thermostat support has been validated primarily against **Ecobee** devices.
- Other thermostat vendors (e.g., Nest) are not yet tested and may require:
  - Additional capability normalization rules
  - Vendor-specific fallbacks

### UI / UX
- Battery percentage text is displayed, but:
  - Thresholds are currently hardcoded
  - No user-configurable warning levels yet
- Low-battery visual alerts are present but not configurable.

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
