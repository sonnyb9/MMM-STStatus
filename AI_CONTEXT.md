# AI Context - MMM-STStatus

This file documents issues, fixes, and important context for AI assistants working with this module.

---

## Issue: OAuth Token Expiration After Daily Restarts (March 2026)

### Symptoms
- Module stopped updating device status after ~5 days
- Error logs showed `invalid_grant` errors when attempting token refresh
- HTTP 401 errors with empty response body during OAuth token exchange
- Last successful token refresh was March 22, 2026 at 23:56
- Multiple restarts between March 23-27 with no token refresh attempts logged

### Root Cause
**Primary:** The OAuth refresh token became invalid, likely due to:
1. Tokens expiring before scheduled refresh could occur
2. Possible revocation by SmartThings due to old OAuth app configuration

**Contributing Factor:** Daily PM2 restarts (for MagicMirror updates) were resetting the `setInterval` timer that schedules token refreshes, preventing the 20-hour refresh cycle from completing.

### Investigation Process
1. Checked PM2 logs - found no token refresh attempts after March 22
2. Found `invalid_grant` errors in error logs dating back to February/March
3. Verified code had startup token expiration check via `tokensNeedRefresh()` - but it wasn't triggering refreshes
4. Researched SmartThings OAuth API changes in 2025/2026:
   - SmartThings changed OAuth app types (now only "OAuth-In App" supported)
   - Multiple users reported similar 401/empty response issues throughout 2025
   - Community reports of authorization code truncation and redirect URI validation issues

### Solution
1. **Created fresh OAuth app** via SmartThings CLI (`smartthings apps:create`)
   - Old Client ID: `fa85ab36-9300-4264-8601-fdbb1bc24cfa`
   - New Client ID: `8037668c-bb63-4aa5-8c87-1174e14812b0`
   - App Type: "OAuth-In App" (only type available in current CLI)
   - Redirect URI: `https://httpbin.org/get` (exact, no trailing slash)
   - Scopes: `r:devices:*`, `x:devices:*`, `r:locations:*`

2. **Re-ran setup.js** with new credentials
   - Generated fresh access token and refresh token
   - Saved encrypted to `oauth-data.enc` (updated 2026-03-27 22:11)

3. **Changed token refresh interval** from 20 hours → 12 hours
   - File: `node_helper.js`, line ~194
   - Rationale: Defense-in-depth for environments with daily restarts
   - Tokens expire after 24 hours; 12-hour refresh provides 12-hour safety buffer
   - Low cost: one extra API call per day

### Verification
- OAuth data file updated: `oauth-data.enc` (2026-03-27 22:11)
- New credentials loaded successfully (verified via node script)
- MagicMirror restarted (PM2)
- Module configured and loaded

### Preventive Measures
1. **12-hour token refresh** - Refreshes tokens twice daily
2. **Startup expiration check** - Code already calls `tokensNeedRefresh()` on initialization
3. **Fresh OAuth credentials** - Eliminates any legacy app configuration issues

### SmartThings OAuth App Configuration (Current)
- **Client ID:** `8037668c-bb63-4aa5-8c87-1174e14812b0`
- **App Type:** OAuth-In App
- **Redirect URI:** `https://httpbin.org/get`
- **Scopes:** `r:devices:*`, `x:devices:*`, `r:locations:*`
- **Created:** 2026-03-27 via SmartThings CLI on AuroraR16

### Related Files
- `node_helper.js` - Token refresh logic (lines 185-210)
- `oauth-utils.js` - Encryption/decryption and token validation
- `oauth-data.enc` - Encrypted OAuth credentials and tokens
- `oauth-key.bin` - AES-256-GCM encryption key (32 bytes)
- `setup.js` - Interactive OAuth setup wizard

### Future Considerations
If token expiration issues recur:
1. Check if `tokensNeedRefresh()` is actually being called on startup
2. Add more verbose logging to token refresh logic
3. Consider adding monitoring/alerting for OAuth errors
4. Verify SmartThings API hasn't changed OAuth requirements again

### SmartThings API Quirks (2025-2026)
- OAuth app types simplified to "OAuth-In App" only
- Authorization codes expire very quickly (~2-5 minutes)
- Token exchange sometimes returns HTTP 401 with empty body
- Redirect URI must match exactly (no trailing slash tolerance)
- Some users report authorization codes being truncated to 6 characters

### References
- SmartThings OAuth Documentation: https://developer.smartthings.com/docs/connected-services/oauth-integrations
- GitHub Issue (homebridge-smartthings-washer): OAuth flow failures with redirect_uri validation
- Reddit/Community Reports: Multiple reports of 401 Unauthorized errors in 2025

---

## Code Changes - Token Refresh Interval

### Modified: node_helper.js (2026-03-27)

```javascript
// OLD (20 hours):
const refreshInterval = 20 * 60 * 60 * 1000; // 72000000 ms
this.log("Scheduling token refresh every 20 hours", true);

// NEW (12 hours):
const refreshInterval = 12 * 60 * 60 * 1000; // 43200000 ms
this.log("Scheduling token refresh every 12 hours", true);
```

**Lines:** ~192-199 in `node_helper.js`

---

## Diagnostic Tools Created

### test-oauth.js (2026-03-27)
Standalone diagnostic script for testing OAuth credentials before running full setup.

**Usage:**
```bash
cd ~/MagicMirror/modules/MMM-STStatus
node test-oauth.js
```

**Purpose:**
- Tests token exchange with detailed debugging output
- Shows exact HTTP requests/responses
- Identifies Client ID/Secret mismatches
- Verifies redirect URI configuration
- Useful for diagnosing 401/empty response errors

**Location:** `test-oauth.js` (6.3KB, executable)

---

## Important Notes for AI Assistants

1. **Always check PM2 logs** when diagnosing OAuth issues:
   ```bash
   pm2 logs MagicMirror-TV --lines 200 --nostream | grep -i ststatus
   tail -200 /home/pi/.pm2/logs/MagicMirror-TV-error.log | grep -i ststatus
   ```

2. **OAuth data validation:**
   ```bash
   cd ~/MagicMirror/modules/MMM-STStatus
   node -e "const {loadOAuthData} = require('./oauth-utils'); console.log(loadOAuthData(__dirname));"
   ```

3. **Token refresh interval** is in `node_helper.js` around line 194 (`refreshInterval = 12 * 60 * 60 * 1000`)

4. **Don't confuse app types:** SmartThings now uses "OAuth-In App" - old references to "WEBHOOK_SMART_APP" or "API_ONLY" may be outdated

5. **Redirect URI is critical:** Must be exactly `https://httpbin.org/get` (no trailing slash)

6. **Authorization codes expire fast:** Users must complete OAuth flow within 2-5 minutes

7. **If setup.js fails with 401 empty response:**
   - Verify Client ID/Secret match the SmartThings app exactly
   - Check redirect URI is configured correctly in SmartThings
   - Try creating a completely fresh OAuth app via CLI
   - Use `test-oauth.js` for detailed diagnostics

---

Last Updated: 2026-03-27
