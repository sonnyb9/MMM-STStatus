# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2025-12-12

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
