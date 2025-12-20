# MMM-STStatus Testing Guide

## Beta Testing on Raspberry Pi

This guide provides step-by-step instructions for beta testing the MMM-STStatus module on a Raspberry Pi.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [System Preparation](#2-system-preparation)
3. [MagicMirror Installation](#3-magicmirror-installation)
4. [PM2 Process Manager Setup](#4-pm2-process-manager-setup)
5. [Module Installation](#5-module-installation)
6. [SmartThings OAuth Setup](#6-smartthings-oauth-setup)
7. [Setup Wizard](#7-setup-wizard)
8. [Test Mode Testing](#8-test-mode-testing)
9. [Live Testing](#9-live-testing)
10. [Functional Test Checklist](#10-functional-test-checklist)
11. [Performance Testing](#11-performance-testing)
12. [Troubleshooting](#12-troubleshooting)
13. [Reporting Issues](#13-reporting-issues)

---

## 1. Prerequisites

### Hardware
- Raspberry Pi 4 or 5 (4GB RAM recommended)
- MicroSD card (32GB+ recommended)
- Power supply (official Pi power supply recommended)
- Monitor connected via HDMI
- Keyboard and mouse (for initial setup)
- Network connection (Ethernet or WiFi)

### Software
- Raspberry Pi OS Bookworm (64-bit)
- Fresh installation or existing system with updates applied

### Accounts
- SmartThings account with connected devices
- GitHub account (for repository access)

---

## 2. System Preparation

### 2.1 Update System Packages

```bash
sudo apt update && sudo apt upgrade -y
```

### 2.2 Install Required Dependencies

```bash
# Install Node.js 20.x (LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version    # Should show v20.x.x
npm --version     # Should show 10.x.x

# Install git
sudo apt install -y git
```

### 2.3 Verify System Resources

```bash
# Check available memory
free -h

# Check disk space
df -h
```

**Expected:**
- Memory: ~4GB total
- Disk: At least 5GB free

---

## 3. MagicMirror Installation

### 3.1 Clone MagicMirror Repository

```bash
cd ~
git clone https://github.com/MagicMirrorOrg/MagicMirror
cd MagicMirror
```

### 3.2 Install MagicMirror Dependencies

```bash
npm run install-mm
```

This takes several minutes on a Pi.

### 3.3 Create Initial Configuration

```bash
cp config/config.js.sample config/config.js
```

### 3.4 Test MagicMirror Base Installation

```bash
npm run start
```

**Expected:** MagicMirror launches with default modules (clock, calendar, etc.)

Press `Ctrl+Q` to exit.

---

## 4. PM2 Process Manager Setup

PM2 keeps MagicMirror running and auto-starts on boot.

### 4.1 Install PM2

```bash
sudo npm install -g pm2
```

### 4.2 Create Startup Script

```bash
cat > ~/MagicMirror/mm.sh << 'EOF'
#!/bin/bash
cd ~/MagicMirror
DISPLAY=:0 npm start
EOF

chmod +x ~/MagicMirror/mm.sh
```

### 4.3 Start MagicMirror with PM2

```bash
pm2 start ~/MagicMirror/mm.sh --name "MagicMirror"
```

### 4.4 Configure Auto-Start on Boot

```bash
pm2 startup
# Run the command that PM2 outputs

pm2 save
```

### 4.5 PM2 Commands Reference

| Command | Description |
|---------|-------------|
| `pm2 status` | Show process status |
| `pm2 logs MagicMirror` | View live logs |
| `pm2 logs MagicMirror --lines 100` | View last 100 lines |
| `pm2 restart MagicMirror` | Restart MagicMirror |
| `pm2 stop MagicMirror` | Stop MagicMirror |

---

## 5. Module Installation

### 5.1 Stop MagicMirror

```bash
pm2 stop MagicMirror
```

### 5.2 Clone the Repository

```bash
cd ~/MagicMirror/modules
git clone https://github.com/sonnyb9/MMM-STStatus.git
cd MMM-STStatus
npm install
```

### 5.3 Verify Installation

```bash
ls -la
```

**Expected files:**
```
MMM-STStatus.js
node_helper.js
setup.js
oauth-utils.js
package.json
README.md
CHANGELOG.md
TESTING_GUIDE.md
LICENSE
css/
translations/
node_modules/
screenshots/
```

---

## 6. SmartThings OAuth Setup

OAuth is required for authentication. Personal Access Tokens expire after 24 hours and are not supported.

### 6.1 Install SmartThings CLI

Download from: https://github.com/SmartThingsCommunity/smartthings-cli/releases

**On Raspberry Pi (Linux ARM64):**
```bash
# Download the appropriate release for ARM64
wget https://github.com/SmartThingsCommunity/smartthings-cli/releases/download/v1.X.X/smartthings-linux-arm64.tar.gz

# Extract and install
tar -xzf smartthings-linux-arm64.tar.gz
sudo mv smartthings /usr/local/bin/

# Verify
smartthings --version
```

**Note:** Replace `v1.X.X` with the latest version from the releases page.

### 6.2 Login to SmartThings CLI

```bash
smartthings devices
```

A URL will be displayed - open it in a browser on another device to authenticate.

### 6.3 Create OAuth App

```bash
smartthings apps:create
```

Enter:
- **App type**: OAuth-In App
- **Display name**: `MMM-STStatus`
- **Description**: `MagicMirror SmartThings Status Display`
- **Icon image URL**: (leave blank)
- **Target URL**: (leave blank)
- **Scopes**: Select:
  - `r:devices:*`
  - `x:devices:*`
  - `r:locations:*`
- **Redirect URIs**: `https://httpbin.org/get`

**IMPORTANT:** Save the OAuth Client ID and Client Secret! You won't see them again.

---

## 7. Setup Wizard

The setup wizard handles OAuth authentication and generates your configuration.

### 7.1 Run Setup

```bash
cd ~/MagicMirror/modules/MMM-STStatus
node setup.js
```

### 7.2 Follow the Prompts

**Step 1: OAuth Authentication**
- Enter your Client ID
- Enter your Client Secret
- Open the authorization URL in a browser
- After authorizing, copy the FULL redirect URL from your browser
- Paste it into the terminal

**Step 2: Position Selection**
- Choose where the module appears (e.g., `top_right`)

**Step 3: Location Selection**
- Select your SmartThings location

**Step 4: Room Selection**
- Enter room numbers (comma-separated) or `all`

**Step 5: Device Selection**
- Enter device numbers (comma-separated), `all`, or `none`
- Selecting `none` uses room-based selection

**Step 6: Display Options**
- Poll interval (default: 60 seconds)
- Show last updated time (Y/n)
- Temperature unit (F/C)
- Sort order (name/room/capability)
- Debug logging (y/N)

**Step 7: Config Output**
- Copy the generated config block

### 7.3 Update config.js

```bash
nano ~/MagicMirror/config/config.js
```

Paste the generated config into the `modules` array.

### 7.4 Start MagicMirror

```bash
pm2 start MagicMirror
```

---

## 8. Test Mode Testing

Test mode uses mock data - useful for verifying the module works without SmartThings.

### 8.1 Configure Test Mode

Edit config.js and set:
```javascript
config: {
  clientId: "test",
  clientSecret: "test",
  testMode: true,
  debug: true
}
```

### 8.2 Verify Test Mode

- [ ] Module appears in configured position
- [ ] Mock devices are displayed
- [ ] Icons appear correctly
- [ ] Colors are correct:
  - Green: ON, CLOSED, LOCKED, HOME
  - Red: OPEN, UNLOCKED
  - Blue: MOTION
  - Grey: OFF, AWAY
- [ ] "Last Update: HH:MM:SS" clock time shows

### 8.3 Check Console

```bash
pm2 logs MagicMirror --lines 50
```

Look for:
```
[MMM-STStatus] Test mode enabled, using mock data
```

---

## 9. Live Testing

### 9.1 Verify Live Data

- [ ] Your actual devices appear
- [ ] Device names match SmartThings app
- [ ] States are correct (compare with SmartThings app)
- [ ] Updates occur at poll interval

### 9.2 Test State Changes

1. Open SmartThings app on your phone
2. Toggle a switch or open/close a door
3. Wait for poll interval
4. Verify change appears on mirror

### 9.3 Test OAuth Token Refresh

The module auto-refreshes tokens every 20 hours. To test:

1. Note the current time
2. Check logs after 20+ hours for:
   ```
   [MMM-STStatus] Scheduling token refresh
   [MMM-STStatus] Tokens refreshed successfully
   ```

### 9.4 Verify Caching

```bash
ls -la ~/MagicMirror/modules/MMM-STStatus/.cache.json
cat ~/MagicMirror/modules/MMM-STStatus/.cache.json | head -20
```

---

## 10. Functional Test Checklist

### Display Tests
- [ ] Module loads without errors
- [ ] Module appears in correct position
- [ ] Header displays correctly
- [ ] Device table renders properly
- [ ] Icons display (Font Awesome)
- [ ] Colors match state
- [ ] Last update clock time shows/hides correctly

### Data Tests
- [ ] Explicit device list works
- [ ] Room-based selection works
- [ ] Device names display correctly
- [ ] Primary state shows correctly
- [ ] Secondary attributes (battery, temp) show
- [ ] Temperature converts F ↔ C correctly
- [ ] Sorting works

### Device Type Tests
- [ ] Switches: ON/OFF with lightbulb icon
- [ ] Contact sensors: OPEN/CLOSED with door icons
- [ ] Motion sensors: MOTION/— with person icons
- [ ] Locks: LOCKED/UNLOCKED with lock icons
- [ ] Presence: HOME/AWAY with house icons
- [ ] Temperature sensors: Correct reading with thermometer icon
- [ ] Thermostats: Temperature, setpoints, operating state colors
- [ ] Blinds/shades: Percentage with window icon
- [ ] Dimmers: Percentage with slider icon
- [ ] Battery: Percentage with appropriate battery icon

### Error Handling Tests
- [ ] Module continues after network errors
- [ ] Cache is used when API unavailable
- [ ] Error messages are user-friendly
- [ ] Footer alerts appear after 10 consecutive failures
- [ ] Alert auto-dismisses when API recovers
- [ ] Alert styling is yellow/amber and visible

### Configuration Tests
- [ ] `testMode: true` uses mock data
- [ ] `debug: true` shows verbose logs
- [ ] `pollInterval` is respected
- [ ] `showLastUpdated: false` hides last update time
- [ ] `temperatureUnit: "C"` shows Celsius

---

## 11. Performance Testing

### 11.1 Memory Usage

```bash
# While MagicMirror is running
ps aux | grep -E "(electron|node)" | grep -v grep

# Monitor over time
watch -n 5 'free -h'
```

**Expected:** Memory stable, not continuously increasing.

### 11.2 CPU Usage

```bash
top -o %CPU -n 1 -b | head -20
```

**Expected:** Low CPU except brief spikes during updates.

### 11.3 Long-Running Test

Leave running for 24+ hours and verify:
- [ ] No memory leaks
- [ ] No crashes
- [ ] Token refresh works
- [ ] Updates continue

---

## 12. Troubleshooting

### Module Not Appearing

```bash
# Check logs
pm2 logs MagicMirror --lines 100

# Verify module directory
ls ~/MagicMirror/modules/MMM-STStatus/

# Check config.js syntax
node -c ~/MagicMirror/config/config.js
```

### OAuth Issues

```bash
# Re-run setup
cd ~/MagicMirror/modules/MMM-STStatus
node setup.js

# Check if tokens exist
ls -la oauth-tokens.enc
```

### Icons Not Showing

```bash
# Reinstall dependencies
cd ~/MagicMirror/modules/MMM-STStatus
rm -rf node_modules
npm install
```

### High CPU/Memory

- Increase `pollInterval` to 120000 (2 minutes)
- Reduce number of devices
- Set `debug: false`

---

## 13. Reporting Issues

When reporting bugs, please include:

### System Info
```bash
uname -a
node --version
npm --version
cat ~/MagicMirror/package.json | grep version
cat ~/MagicMirror/modules/MMM-STStatus/package.json | grep version
```

### Logs
```bash
# Module logs (with debug: true in config)
pm2 logs MagicMirror --lines 200 2>&1 | grep -i ststatus
```

### Config (REMOVE SECRETS!)
```bash
# Show config without credentials
cat ~/MagicMirror/config/config.js | grep -A 20 "MMM-STStatus" | sed 's/clientId:.*/clientId: "REDACTED",/' | sed 's/clientSecret:.*/clientSecret: "REDACTED",/'
```

### Description
- Steps to reproduce
- Expected behavior
- Actual behavior
- Screenshots if applicable

---

## Test Results Log

| Test | Date | Result | Notes |
|------|------|--------|-------|
| System prep | | ☐ Pass ☐ Fail | |
| MM install | | ☐ Pass ☐ Fail | |
| Module install | | ☐ Pass ☐ Fail | |
| OAuth setup | | ☐ Pass ☐ Fail | |
| Setup wizard | | ☐ Pass ☐ Fail | |
| Test mode | | ☐ Pass ☐ Fail | |
| Live testing | | ☐ Pass ☐ Fail | |
| Device types | | ☐ Pass ☐ Fail | |
| Error handling | | ☐ Pass ☐ Fail | |
| Performance (24h) | | ☐ Pass ☐ Fail | |

---

*Guide Version: 2.1 | Module Version: 0.3.2 | Last Updated: 2025-12-19*
