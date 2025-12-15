# MMM-STStatus Testing Guide

## Raspberry Pi 5 or Virtual Machine Testing

This guide provides step-by-step instructions for testing the MMM-STStatus module. You can test on either:
- **Physical Raspberry Pi 5** (4GB RAM) with Raspberry Pi OS Bookworm
- **Virtual Machine** using Raspberry Pi Desktop (x86) in VirtualBox

---

## Table of Contents

0. [Testing Environment Options](#0-testing-environment-options)
1. [Prerequisites](#1-prerequisites)
2. [System Preparation](#2-system-preparation)
3. [MagicMirror Installation](#3-magicmirror-installation)
4. [PM2 Process Manager Setup](#4-pm2-process-manager-setup)
5. [Module Installation](#5-module-installation)
6. [Test Mode Testing](#6-test-mode-testing-no-api-required)
7. [Live API Testing](#7-live-api-testing)
8. [Setup Script Testing](#8-setup-script-testing)
9. [Functional Test Checklist](#9-functional-test-checklist)
10. [Performance Testing](#10-performance-testing)
11. [Troubleshooting](#11-troubleshooting)
12. [Clean Up](#12-clean-up)

---

## 0. Testing Environment Options

You have two options for testing. The VM option is recommended for initial development and debugging due to faster iteration cycles.

### Option A: Virtual Machine (Recommended for Development)

Using a VM allows faster testing iterations without repeatedly flashing SD cards. The Raspberry Pi Foundation provides an x86 version of their OS that runs natively in VirtualBox.

#### What You CAN Test in a VM

| Feature | VM Support |
|---------|------------|
| Module functionality | ✅ Yes |
| SmartThings API integration | ✅ Yes |
| CSS/Display rendering | ✅ Yes |
| PM2 process management | ✅ Yes |
| Setup script | ✅ Yes |
| All error handling | ✅ Yes |

#### What Requires Physical Pi

| Feature | Reason |
|---------|--------|
| ARM performance profiling | Different CPU architecture |
| Actual memory constraints | VM has flexible resources |
| Boot/autostart testing | Pi-specific boot process |
| GPIO/hardware integration | No hardware in VM |

#### VM Setup: Raspberry Pi Desktop in VirtualBox

**Step 1: Download Required Software**

- VirtualBox: https://www.virtualbox.org/wiki/Downloads
- Raspberry Pi Desktop ISO: https://www.raspberrypi.com/software/raspberry-pi-desktop/

**Step 2: Create Virtual Machine**

1. Open VirtualBox and click **New**
2. Configure the VM:
   ```
   Name: RPi-Desktop-Testing
   Type: Linux
   Version: Debian (64-bit)
   ```
3. Click **Next**

**Step 3: Allocate Memory**

```
Memory: 4096 MB (4 GB)
```

This matches the Pi 5 4GB configuration.

**Step 4: Create Virtual Hard Disk**

```
- Select "Create a virtual hard disk now"
- Hard disk file type: VDI
- Storage: Dynamically allocated
- Size: 32 GB
```

**Step 5: Configure VM Settings**

Before starting the VM, adjust these settings (right-click VM → Settings):

**System → Processor:**
```
Processors: 2 CPUs (or more if available)
```

**Display → Screen:**
```
Video Memory: 128 MB
Graphics Controller: VMSVGA
Enable 3D Acceleration: ✅ Checked
```

**Storage → Controller: IDE:**
```
Click the empty disk icon → Choose a disk file
Select the downloaded Raspberry Pi Desktop ISO
```

**Network → Adapter 1:**
```
Attached to: NAT (or Bridged for network testing)
```

**Step 6: Install Raspberry Pi Desktop**

1. Start the VM
2. Select **Graphical Install** from the boot menu
3. Follow the installation wizard:
   - Language: English
   - Location: Your location
   - Keyboard: Your layout
   - Hostname: `rpitesting`
   - Username: `pi` (recommended for consistency)
   - Password: Your choice
   - Partition: Use entire disk (guided)
4. Wait for installation to complete (~15-20 minutes)
5. Remove ISO when prompted and reboot

**Step 7: Install VirtualBox Guest Additions**

After first boot, install Guest Additions for better performance:

```bash
# Update system first
sudo apt update && sudo apt upgrade -y

# Install required packages
sudo apt install -y build-essential dkms linux-headers-$(uname -r)

# Insert Guest Additions CD (VirtualBox menu: Devices → Insert Guest Additions CD)
# Then run:
sudo mount /dev/cdrom /mnt
sudo /mnt/VBoxLinuxAdditions.run

# Reboot
sudo reboot
```

**Step 8: Enable Shared Clipboard and Drag-n-Drop (Optional)**

In VirtualBox menu: Devices → Shared Clipboard → Bidirectional
In VirtualBox menu: Devices → Drag and Drop → Bidirectional

**Step 9: Take a Snapshot**

Before proceeding, take a VM snapshot so you can easily reset to a clean state:

VirtualBox menu: Machine → Take Snapshot

Name it "Clean Install - Ready for MagicMirror"

#### VM Testing Notes

- **Performance:** The VM will feel slower than a real Pi 5, but functionality testing is identical
- **Resolution:** You can resize the VM window; Guest Additions enables auto-resize
- **Snapshots:** Use snapshots liberally to save known-good states
- **Networking:** NAT mode works for SmartThings API; use Bridged mode if you need to access MM from other devices

After VM setup is complete, proceed to **Section 1: Prerequisites** and continue with the guide. Skip the physical Pi hardware requirements.

---

### Option B: Physical Raspberry Pi 5

If testing on actual hardware, proceed directly to **Section 1: Prerequisites**.

Recommended for:
- Final validation before deployment
- Performance benchmarking
- Boot/autostart testing
- Production configuration

---

## 1. Prerequisites

### Hardware (Physical Pi Only)
- Raspberry Pi 5 with 4GB RAM
- MicroSD card (32GB+ recommended)
- Power supply (official Pi 5 27W recommended)
- Monitor connected via HDMI
- Keyboard and mouse (for initial setup)
- Network connection (Ethernet or WiFi)

### Hardware (VM Only)
- Windows, macOS, or Linux computer
- At least 8GB RAM (4GB for VM + 4GB for host)
- 40GB free disk space
- VirtualBox installed (https://www.virtualbox.org/)

### Software
- Raspberry Pi OS Bookworm (64-bit) — for physical Pi
- Raspberry Pi Desktop (x86) — for VM testing
- Fresh installation or existing system with updates applied

### Accounts
- SmartThings account with connected devices (for live testing)
- SmartThings Personal Access Token (for live testing)

---

## 2. System Preparation

### 2.1 Update System Packages

Open a terminal and run:

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

# Install additional dependencies
sudo apt install -y git
```

### 2.3 Verify System Resources

```bash
# Check available memory
free -h

# Check disk space
df -h

# Check CPU
lscpu | grep "Model name"
```

**Expected output:**
- Memory: ~4GB total
- Disk: At least 5GB free recommended
- CPU: ARM Cortex-A76 (Pi 5)

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

This will take several minutes on the Pi 5.

### 3.3 Create Initial Configuration

```bash
cp config/config.js.sample config/config.js
```

### 3.4 Test MagicMirror Base Installation

```bash
npm run start
```

**Expected result:** MagicMirror launches with default modules (clock, calendar, etc.)

Press `Ctrl+Q` to exit, or from another terminal:
```bash
pkill -f "electron"
```

---

## 4. PM2 Process Manager Setup

PM2 is a production process manager that keeps MagicMirror running, automatically restarts it on crashes, and starts it on boot.

### 6.1 Install PM2 Globally

```bash
sudo npm install -g pm2
```

### 6.2 Create PM2 Startup Script

Create a script that PM2 will use to start MagicMirror:

```bash
cat > ~/MagicMirror/mm.sh << 'EOF'
#!/bin/bash
cd ~/MagicMirror
DISPLAY=:0 npm start
EOF

chmod +x ~/MagicMirror/mm.sh
```

### 6.3 Start MagicMirror with PM2

```bash
pm2 start ~/MagicMirror/mm.sh --name "MagicMirror"
```

### 6.4 Verify PM2 Status

```bash
pm2 status
```

**Expected output:** MagicMirror with status 'online':
```
┌─────┬──────────────┬─────────────┬─────────┬─────────┬──────────┐
│ id  │ name         │ namespace   │ version │ mode    │ pid      │
├─────┼──────────────┼─────────────┼─────────┼─────────┼──────────┤
│ 0   │ MagicMirror  │ default     │ N/A     │ fork    │ 1234     │
└─────┴──────────────┴─────────────┴─────────┴─────────┴──────────┘
```

### 6.5 Configure PM2 Auto-Start on Boot

```bash
# Generate startup script
pm2 startup

# Copy and run the command that PM2 outputs, it will look like:
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u pi --hp /home/pi

# Save the current PM2 process list
pm2 save
```

### 6.6 PM2 Management Commands

| Command | Description |
|---------|-------------|
| `pm2 status` | Show status of all processes |
| `pm2 logs MagicMirror` | View MagicMirror logs (live) |
| `pm2 logs MagicMirror --lines 100` | View last 100 log lines |
| `pm2 restart MagicMirror` | Restart MagicMirror |
| `pm2 stop MagicMirror` | Stop MagicMirror |
| `pm2 start MagicMirror` | Start MagicMirror (if stopped) |
| `pm2 delete MagicMirror` | Remove from PM2 (doesn't delete files) |
| `pm2 monit` | Open real-time monitoring dashboard |

> **Note:** When testing the module, you may want to stop PM2 and run MagicMirror manually to see console output directly:
> ```bash
> pm2 stop MagicMirror && cd ~/MagicMirror && npm start
> ```

### 6.7 View Logs for Debugging

PM2 stores logs in `~/.pm2/logs/`. View them with:

```bash
# Live logs (like tail -f)
pm2 logs MagicMirror

# Or view log files directly
cat ~/.pm2/logs/MagicMirror-out.log    # stdout
cat ~/.pm2/logs/MagicMirror-error.log  # stderr

# Clear logs
pm2 flush MagicMirror
```

---

## 5. Module Installation

### 6.1 Stop MagicMirror (if running via PM2)

```bash
pm2 stop MagicMirror
```

### 6.2 Navigate to Modules Directory

```bash
cd ~/MagicMirror/modules
```

### 6.2 Option A: Install from Zip File

If you have the `MMM-STStatus.zip` file:

```bash
# Copy zip to Pi (via USB, SCP, etc.)
unzip MMM-STStatus.zip
cd MMM-STStatus
npm install
```

### 6.2 Option B: Clone from Repository

```bash
git clone https://github.com/YOUR_USERNAME/MMM-STStatus.git
cd MMM-STStatus
npm install
```

### 6.3 Verify Installation

```bash
# Check that dependencies installed correctly
ls -la node_modules/@fortawesome/fontawesome-free

# Should see the fontawesome directory
```

### 6.4 Check File Permissions

```bash
# Ensure setup.js is executable
chmod +x setup.js

# Verify all files are present
ls -la
```

**Expected files:**
```
MMM-STStatus.js
node_helper.js
MMM-STStatus.css
setup.js
package.json
README.md
CHANGELOG.md
LICENSE
.gitignore
.eslintrc.json
node_modules/
screenshots/
translations/
```

---

## 6. Test Mode Testing (No API Required)

Test mode uses mock data - perfect for verifying the module works before connecting to SmartThings.

### 6.1 Configure Test Mode

Edit the MagicMirror config file:

```bash
nano ~/MagicMirror/config/config.js
```

Add the module to the `modules` array:

```javascript
{
  module: "MMM-STStatus",
  position: "top_left",
  header: "Smart Home (Test Mode)",
  config: {
    token: "test-token-not-used",
    testMode: true,
    showLastUpdated: true,
    temperatureUnit: "F",
    defaultSort: "name",
    debug: true
  }
},
```

Save and exit (`Ctrl+X`, then `Y`, then `Enter`).

### 6.2 Launch MagicMirror

```bash
cd ~/MagicMirror
npm run start
```

### 6.3 Verify Test Mode Display

**Expected behavior:**
- [ ] Module appears in top_left position
- [ ] Header shows "Smart Home (Test Mode)"
- [ ] 10 mock devices are displayed
- [ ] Icons appear correctly (lightbulb, door, lock, etc.)
- [ ] Colors are correct:
  - Green: ON, CLOSED, LOCKED, HOME
  - Red: OPEN, UNLOCKED
  - Blue: MOTION
  - Grey: OFF, AWAY, inactive
- [ ] "Updated: HH:MM" timestamp shows at bottom
- [ ] Motion sensor toggles between MOTION and — every poll interval

### 6.4 Check Console for Errors

Open the developer console:
- Press `Ctrl+Shift+I` to open DevTools
- Click "Console" tab

**Expected:** No red error messages related to MMM-STStatus

### 6.5 Check Node Helper Logs

In terminal where MagicMirror is running, look for:
```
[MMM-STStatus] Node helper started
[MMM-STStatus] Config received
[MMM-STStatus] Test mode enabled, using mock data
```

### 6.6 Exit Test

Press `Ctrl+Q` or close the window.

---

## 7. Live API Testing

### 7.1 Obtain SmartThings PAT

1. Go to: https://account.smartthings.com/tokens
2. Log in with your Samsung account
3. Click **Generate new token**
4. Name: "MagicMirror Testing"
5. Select scopes:
   - `r:devices:*`
   - `r:locations:*`
6. Click **Generate token**
7. **COPY THE TOKEN NOW** (it won't be shown again)

### 7.2 Test API Access (Optional)

Verify your token works before configuring the module:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN_HERE" \
     https://api.smartthings.com/v1/locations
```

**Expected:** JSON response with your locations.

### 7.3 Configure Live Mode

Edit config again:

```bash
nano ~/MagicMirror/config/config.js
```

Update the module config:

```javascript
{
  module: "MMM-STStatus",
  position: "top_left",
  header: "Smart Home",
  config: {
    token: "YOUR_ACTUAL_PAT_HERE",
    rooms: ["Living Room", "Kitchen"],  // Use YOUR room names
    pollInterval: 60000,
    showLastUpdated: true,
    temperatureUnit: "F",
    defaultSort: "name",
    debug: true,    // Keep true for testing
    testMode: false
  }
},
```

**Important:** Replace room names with rooms that exist in YOUR SmartThings setup.

### 7.4 Launch and Monitor

```bash
cd ~/MagicMirror
npm run start
```

Watch the terminal for log output:

```
[MMM-STStatus] Config received
[MMM-STStatus] Using location: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
[MMM-STStatus] Fetching devices from room: Living Room
[MMM-STStatus] Resolved 5 total devices
```

### 7.5 Verify Live Data

**Check:**
- [ ] Your actual devices appear
- [ ] Device names match SmartThings app
- [ ] States are correct (verify by checking SmartThings app)
- [ ] Updates occur every 60 seconds (watch timestamp)

### 7.6 Test State Changes

1. Open SmartThings app on your phone
2. Toggle a switch or open/close a door
3. Wait up to 60 seconds (or your poll interval)
4. Verify the change appears on the mirror

### 7.7 Test Caching

```bash
# Check that cache file was created
ls -la ~/MagicMirror/modules/MMM-STStatus/.cache.json

# View cache contents
cat ~/MagicMirror/modules/MMM-STStatus/.cache.json | head -20
```

---

## 8. Setup Script Testing

### 8.1 Run the Setup Script

```bash
cd ~/MagicMirror/modules/MMM-STStatus
npm run setup
```

### 8.2 Follow Interactive Prompts

Test each step:

1. **Token Entry**
   - [ ] Enter your valid PAT
   - [ ] Script validates format (UUID)
   - [ ] Script tests API connection
   - [ ] Shows "Token validated successfully!"

2. **Position Selection**
   - [ ] All 13 positions are listed
   - [ ] Can select by number
   - [ ] Can select by name

3. **Location Selection**
   - [ ] Your location(s) appear
   - [ ] Can select correct location

4. **Room Selection**
   - [ ] All rooms from SmartThings appear
   - [ ] Can select multiple (comma-separated)
   - [ ] Can select "all"

5. **Device Selection**
   - [ ] Devices from selected rooms appear
   - [ ] Capabilities are shown for each device
   - [ ] Can select specific devices or "all"

6. **Options**
   - [ ] Poll interval prompt works
   - [ ] Temperature unit prompt works
   - [ ] Sort option prompt works

7. **Output**
   - [ ] Valid config block is generated
   - [ ] Config is properly formatted
   - [ ] Token is included
   - [ ] Selected rooms/devices are included

### 8.3 Test Dry Run Mode

```bash
npm run setup -- --dry-run
```

Verify it shows "DRY RUN MODE" message.

### 8.4 Test Cancellation

Run setup again and press `Ctrl+C` at any prompt.

**Expected:** Clean exit message "Setup cancelled. No changes were made."

---

## 9. Functional Test Checklist

Run through each test and check off when verified:

### Display Tests
- [ ] Module loads without JavaScript errors
- [ ] Module appears in configured position
- [ ] Header text displays correctly
- [ ] Device table renders properly
- [ ] Icons display (Font Awesome loads)
- [ ] Colors match state (green/red/blue/grey)
- [ ] Last updated timestamp shows
- [ ] Responsive on different positions

### Data Tests
- [ ] Devices from explicit list work
- [ ] Devices from rooms work
- [ ] Combined (explicit + rooms) works
- [ ] Device names display correctly
- [ ] Primary state shows correctly
- [ ] Secondary attributes (battery, temp) show
- [ ] Temperature converts F ↔ C correctly
- [ ] Sorting works (name, room, capability)

### API Tests
- [ ] Initial data loads successfully
- [ ] Polling updates at configured interval
- [ ] Rate limiting warning appears at 200 req/min
- [ ] 401/403 shows auth error message
- [ ] Network errors show cached data message
- [ ] Cache is created and used

### Error Handling Tests
- [ ] Invalid token shows user-friendly error
- [ ] Empty rooms array is handled
- [ ] Missing device shows graceful fallback
- [ ] Module continues after transient errors

### Configuration Tests
- [ ] testMode: true uses mock data
- [ ] debug: true shows verbose logs
- [ ] debug: false hides verbose logs
- [ ] pollInterval is respected (min 30s)
- [ ] showLastUpdated: false hides timestamp

---

## 10. Performance Testing

### 10.1 Memory Usage

While MagicMirror is running:

```bash
# Check MagicMirror process memory
ps aux | grep -E "(electron|node)" | grep -v grep

# Monitor over time
watch -n 5 'free -h'
```

**Expected:** Memory usage should be stable, not continuously increasing.

### 10.2 CPU Usage

```bash
# Monitor CPU
top -p $(pgrep -f electron)

# Or use htop for better view
htop
```

**Expected:** CPU should spike briefly during updates, then return to low usage.

### 10.3 API Request Monitoring

With `debug: true`, count log messages per minute:

```bash
# In another terminal, monitor logs
journalctl -f | grep "MMM-STStatus.*API Request"
```

**Expected:** Requests should match your device count per poll interval.

### 10.4 Long-Running Test

Leave the module running for 1+ hours and verify:
- [ ] No memory leaks (memory stable)
- [ ] No crashes
- [ ] Updates continue working
- [ ] Display remains correct

---

## 11. Troubleshooting

### Issue: Module Not Appearing

**Check:**
```bash
# Verify module is in correct location
ls ~/MagicMirror/modules/MMM-STStatus/

# Check MagicMirror logs
cd ~/MagicMirror
npm run start 2>&1 | tee mm.log
```

**Common causes:**
- Typo in config.js module name
- Missing comma in modules array
- Syntax error in config.js

### Issue: "Cannot find module 'node-fetch'"

**Fix:**
```bash
cd ~/MagicMirror/modules/MMM-STStatus
npm install
```

### Issue: Icons Not Showing

**Check:**
```bash
# Verify Font Awesome installed
ls ~/MagicMirror/modules/MMM-STStatus/node_modules/@fortawesome/
```

**Fix:**
```bash
npm install @fortawesome/fontawesome-free
```

### Issue: Authentication Failed

**Check:**
1. Token is correct (no extra spaces)
2. Token has correct scopes
3. Token hasn't expired
4. Test with curl (see 6.2)

### Issue: No Devices Found

**Check:**
1. Room names match exactly (case-sensitive)
2. Devices are assigned to rooms in SmartThings app
3. Run setup.js to see available rooms/devices

### Issue: High CPU Usage

**Fix:**
- Increase pollInterval to 120000 (2 minutes)
- Reduce number of monitored devices

### Issue: Cache Not Working

**Check:**
```bash
# Verify write permissions
touch ~/MagicMirror/modules/MMM-STStatus/.cache.json
ls -la ~/MagicMirror/modules/MMM-STStatus/.cache.json
```

### Collecting Debug Information

If reporting an issue:

```bash
# System info
uname -a
node --version
npm --version

# MagicMirror version
cd ~/MagicMirror && npm list | head -1

# Module logs (with debug: true)
# Copy relevant console output

# Config (REMOVE YOUR TOKEN!)
cat ~/MagicMirror/config/config.js | grep -A 20 "MMM-STStatus"
```

---

## 12. Clean Up

### After Testing

1. **Disable debug mode:**
   ```javascript
   debug: false
   ```

2. **Adjust poll interval for production:**
   ```javascript
   pollInterval: 120000  // 2 minutes for many devices
   ```

3. **Remove test configurations:**
   - Remove testMode if set
   - Use actual rooms/devices

### Reset for Fresh Test

```bash
# Remove cache
rm ~/MagicMirror/modules/MMM-STStatus/.cache.json

# Reinstall dependencies
cd ~/MagicMirror/modules/MMM-STStatus
rm -rf node_modules
npm install
```

### Uninstall Module

```bash
# Remove from config.js first, then:
rm -rf ~/MagicMirror/modules/MMM-STStatus
```

---

## Quick Reference Commands

```bash
# Start MagicMirror
cd ~/MagicMirror && npm run start

# Start in dev mode (shows more errors)
cd ~/MagicMirror && npm run start:dev

# Start in server mode (no display)
cd ~/MagicMirror && npm run server

# View in browser (server mode)
# http://raspberrypi.local:8080 or http://<IP>:8080

# Kill MagicMirror
pkill -f electron

# Edit config
nano ~/MagicMirror/config/config.js

# Check module logs
journalctl -f | grep MMM-STStatus

# Monitor resources
htop
```

---

## Test Results Log

Use this section to record your test results:

| Test | Date | Result | Notes |
|------|------|--------|-------|
| System prep | | ☐ Pass ☐ Fail | |
| MM install | | ☐ Pass ☐ Fail | |
| Module install | | ☐ Pass ☐ Fail | |
| Test mode | | ☐ Pass ☐ Fail | |
| Live API | | ☐ Pass ☐ Fail | |
| Setup script | | ☐ Pass ☐ Fail | |
| Error handling | | ☐ Pass ☐ Fail | |
| Performance | | ☐ Pass ☐ Fail | |

---

*Guide Version: 1.2 | Module Version: 1.0.0 | Last Updated: 2025-12-12*
