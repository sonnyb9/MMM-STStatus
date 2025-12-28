/* node_helper.js
 * Backend helper for MMM-STStatus
 * Handles SmartThings API communication, caching, rate limiting, and OAuth token management
 */

const NodeHelper = require("node_helper");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  loadOAuthData,
  saveOAuthData,
  tokensNeedRefresh,
  getDataFilePath,
  oauthDataExists
} = require("./oauth-utils");

module.exports = NodeHelper.create({
  // Configuration
  config: null,

  // API settings
  API_BASE: "https://api.smartthings.com/v1",
  TOKEN_URL: "https://api.smartthings.com/oauth/token",
  RATE_LIMIT: 250,           // requests per minute
  RATE_WARNING: 200,         // warn at this threshold

  // State
  requestCount: 0,
  requestResetTime: null,
  pollTimer: null,
  tokenRefreshTimer: null,
  backoffDelay: 0,
  locationId: null,
  deviceList: [],
  authFailed: false,

  // Alert tracking
  consecutiveFailures: 0,
  FAILURE_THRESHOLD: 10,
  currentAlert: null,  // { type: string, message: string }
  ALERT_PRIORITY: ["auth", "scope", "network", "rateLimit", "outage", "schema"],

  // OAuth tokens
  oauthData: null,   // Contains clientId, clientSecret, access_token, refresh_token, etc.

  // Cache
  cacheFile: null,
  cache: null,
  CACHE_TTL: 24 * 60 * 60 * 1000, // 24 hours

  /**
   * Called when the helper starts
   */
  start: function () {
    console.log("[MMM-STStatus] Node helper started");
    this.cacheFile = path.join(__dirname, ".cache.json");
    this.resetRateLimit();
  },

  /**
   * Handle socket notifications from frontend
   */
  socketNotificationReceived: function (notification, payload) {
    if (notification === "SET_CONFIG") {
      this.config = payload;
      this.log("Config received", true);
      this.initialize();
    }
  },

  /**
   * Initialize the module
   */
  initialize: async function () {
    // Load cache
    this.loadCache();

    // Check if config changed (invalidate cache)
    const configHash = this.hashConfig(this.config);
    if (this.cache && this.cache.configHash !== configHash) {
      this.log("Config changed, invalidating cache", true);
      this.cache = null;
    }

    // If test mode, use mock data
    if (this.config.testMode) {
      this.log("Test mode enabled, using mock data");
      this.sendMockData();
      return;
    }

    // Initialize authentication
    const authReady = await this.initializeAuth();
    if (!authReady) {
      return;
    }

    // Send cached data immediately if available (faster startup)
    if (this.cache && this.cache.lastStatus) {
      this.log("Sending cached data for fast startup", true);
      this.sendSocketNotification("DEVICE_DATA", {
        devices: this.cache.lastStatus,
        timestamp: this.cache.timestamp
      });
    }

    // Start polling
    this.sendSocketNotification("LOADING", {});
    await this.fetchDevices();
    this.startPolling();
  },

  /**
   * Initialize authentication
   * Loads OAuth data from encrypted file, falls back to legacy PAT in config
   * @returns {boolean} True if authentication is ready
   */
  initializeAuth: async function () {
    // Try loading OAuth data from encrypted file (new approach)
    if (oauthDataExists(__dirname)) {
      return await this.initializeOAuth();
    }

    // Legacy: PAT in config (deprecated but still supported)
    if (this.config.token) {
      this.log("Using Personal Access Token from config (legacy mode)");
      console.warn("[MMM-STStatus] WARNING: PAT in config.js is deprecated. Run setup.js for secure OAuth.");
      return true;
    }

    // No authentication available
    console.error("[MMM-STStatus] ERROR: No OAuth data found. Please run: node setup.js");
    this.sendSocketNotification("ERROR", {
      message: "No OAuth data found. Please run: node setup.js"
    });
    return false;
  },

  /**
   * Initialize OAuth - load data from encrypted file and set up refresh
   * @returns {boolean} True if OAuth is ready
   */
  initializeOAuth: async function () {
    this.log("Initializing OAuth authentication", true);

    // Load OAuth data from encrypted file
    this.oauthData = loadOAuthData(__dirname);

    if (!this.oauthData) {
      console.error("[MMM-STStatus] ERROR: Failed to load OAuth data. Please run setup.js");
      this.sendSocketNotification("ERROR", {
        message: "OAuth data corrupted or key missing. Please re-run: node setup.js"
      });
      return false;
    }

    if (!this.oauthData.clientId || !this.oauthData.clientSecret) {
      console.error("[MMM-STStatus] ERROR: OAuth data missing credentials");
      this.sendSocketNotification("ERROR", {
        message: "OAuth credentials missing. Please re-run: node setup.js"
      });
      return false;
    }

    this.log("OAuth data loaded successfully", true);

    // Check if tokens need refresh
    if (tokensNeedRefresh(this.oauthData)) {
      this.log("Tokens expired or expiring soon, refreshing...");
      const refreshed = await this.refreshTokens();
      if (!refreshed) {
        return false;
      }
    }

    // Schedule automatic token refresh (every 20 hours to be safe before 24h expiry)
    this.scheduleTokenRefresh();

    return true;
  },

  /**
   * Schedule automatic token refresh
   */
  scheduleTokenRefresh: function () {
    if (this.tokenRefreshTimer) {
      clearInterval(this.tokenRefreshTimer);
    }

    // Refresh every 20 hours (72000000 ms)
    // Tokens expire in 24 hours, so this gives us a 4-hour buffer
    const refreshInterval = 20 * 60 * 60 * 1000;

    this.log("Scheduling token refresh every 20 hours", true);

    this.tokenRefreshTimer = setInterval(async () => {
      this.log("Scheduled token refresh triggered");
      await this.refreshTokens();
    }, refreshInterval);

    // Also refresh if tokens will expire within the next hour
    if (this.oauthData && this.oauthData.expiresAt) {
      const expiresIn = new Date(this.oauthData.expiresAt).getTime() - Date.now();
      if (expiresIn < 60 * 60 * 1000 && expiresIn > 0) {
        // Refresh in 1 minute if expiring within an hour
        this.log("Tokens expiring soon, scheduling immediate refresh", true);
        setTimeout(async () => {
          await this.refreshTokens();
        }, 60000);
      }
    }
  },

  /**
   * Refresh OAuth tokens
   * @returns {boolean} True if refresh was successful
   */
  refreshTokens: async function () {
    if (!this.oauthData || !this.oauthData.refresh_token) {
      console.error("[MMM-STStatus] ERROR: No refresh token available");
      this.sendSocketNotification("ERROR", {
        message: "OAuth refresh token missing. Please re-run setup.js"
      });
      return false;
    }

    this.log("Refreshing OAuth tokens...");

    try {
      const params = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.oauthData.refresh_token,
        client_id: this.oauthData.clientId
      });

      // Use Basic Auth header (required by SmartThings)
      const basicAuth = Buffer.from(
        this.oauthData.clientId + ":" + this.oauthData.clientSecret
      ).toString("base64");

      const response = await fetch(this.TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": "Basic " + basicAuth
        },
        body: params.toString()
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Token refresh failed (HTTP ${response.status}): ${errorText}`);
      }

      const newTokens = await response.json();

      // Update OAuth data with new tokens
      this.oauthData = {
        ...this.oauthData,
        access_token: newTokens.access_token,
        refresh_token: newTokens.refresh_token || this.oauthData.refresh_token,
        token_type: newTokens.token_type || "Bearer",
        scope: newTokens.scope || this.oauthData.scope,
        expiresAt: new Date(Date.now() + (newTokens.expires_in || 86400) * 1000).toISOString(),
        obtainedAt: new Date().toISOString()
      };

      // Save updated OAuth data
      saveOAuthData(__dirname, this.oauthData);

      this.log("OAuth tokens refreshed successfully");
      this.authFailed = false;

      return true;

    } catch (err) {
      console.error("[MMM-STStatus] ERROR: Token refresh failed:", err.message);

      // Check if it's an invalid_grant error (refresh token revoked)
      if (err.message.includes("invalid_grant") || err.message.includes("401")) {
        this.authFailed = true;
        this.sendSocketNotification("ERROR", {
          message: "OAuth refresh token invalid. Please re-run setup.js",
          cached: !!this.cache,
          devices: this.cache ? this.cache.lastStatus : null,
          timestamp: this.cache ? this.cache.timestamp : null
        });
      }

      return false;
    }
  },

  /**
   * Get the current access token
   * @returns {string|null} Access token or null
   */
  getAccessToken: function () {
    // OAuth mode (from encrypted file)
    if (this.oauthData && this.oauthData.access_token) {
      return this.oauthData.access_token;
    }

    // Legacy PAT mode (from config)
    return this.config.token || null;
  },

  /**
   * Start polling timer
   */
  startPolling: function () {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }

    const interval = Math.max(this.config.pollInterval || 60000, 30000); // Min 30 seconds
    this.log("Starting poll timer: " + (interval / 1000) + "s", true);

    this.pollTimer = setInterval(() => {
      this.fetchDevices();
    }, interval);
  },

  /**
   * Main fetch routine - gets all device statuses
   */
  fetchDevices: async function () {
    // Stop immediately if authentication has failed
    if (this.authFailed) {
      return;
    }

    // Check if tokens need refresh before making requests
    if (this.oauthData && tokensNeedRefresh(this.oauthData, 600)) {
      this.log("Tokens need refresh before API calls", true);
      const refreshed = await this.refreshTokens();
      if (!refreshed) {
        return;
      }
    }

    try {
      // Resolve device list if needed
      if (this.deviceList.length === 0) {
        await this.resolveDevices();
      }

      if (this.deviceList.length === 0) {
        this.sendSocketNotification("ERROR", {
          message: "No devices found matching configuration."
        });
        return;
      }

      // Fetch status for each device
      const devices = [];
      for (const device of this.deviceList) {
        // Check rate limit before each request
        if (!this.checkRateLimit()) {
          this.log("Rate limit approached, delaying requests");
          await this.delay(1000);
        }

        try {
          const status = await this.fetchDeviceStatus(device.id);
          if (status) {
            const normalized = this.normalizeDevice(device, status);
            if (normalized) {
              devices.push(normalized);
            }
          }
        } catch (err) {
          // Individual device errors don't count as full failures
          this.log("Error fetching device " + device.id + ": " + err.message);
        }
      }

      // SUCCESS - reset failure counter and clear alerts
      this.consecutiveFailures = 0;
      this.clearAlert();

      // Update cache
      this.updateCache({ lastStatus: devices });

      // Send to frontend
      this.sendSocketNotification("DEVICE_DATA", {
        devices: devices,
        timestamp: new Date().toISOString()
      });

    } catch (err) {
      this.handleError(err);
    }
  },

  /**
   * Resolve device list from rooms or explicit config
   * 
   * Priority:
   * 1. If explicit devices are configured, use ONLY those devices
   * 2. If only rooms are configured (no explicit devices), use all devices from those rooms
   */
  resolveDevices: async function () {
    this.deviceList = [];

    // If explicit devices are configured, use ONLY those
    if (this.config.devices && this.config.devices.length > 0) {
      this.log("Using " + this.config.devices.length + " explicitly configured devices only", true);
      this.deviceList = this.config.devices.map(d => ({
        id: d.id,
        name: d.name,
        room: d.room || null
      }));

      // Cache and return - don't also fetch from rooms
      this.updateCache({ devices: this.deviceList });
      this.log("Resolved " + this.deviceList.length + " total devices", true);
      return;
    }

    // No explicit devices - resolve from rooms
    if (this.config.rooms && this.config.rooms.length > 0) {
      this.log("Resolving devices from " + this.config.rooms.length + " rooms", true);

      // Get location ID
      if (!this.locationId) {
        const locations = await this.apiRequest("/locations");
        if (locations && locations.items && locations.items.length > 0) {
          this.locationId = locations.items[0].locationId;
          this.log("Using location: " + this.locationId, true);
        } else {
          throw new Error("No SmartThings locations found");
        }
      }

      // Get rooms
      const roomsResponse = await this.apiRequest(`/locations/${this.locationId}/rooms`);
      if (roomsResponse && roomsResponse.items) {
        for (const room of roomsResponse.items) {
          // Check if this room is in our config
          if (this.config.rooms.includes(room.name)) {
            this.log("Fetching devices from room: " + room.name, true);

            // Get devices in this room
            const devicesResponse = await this.apiRequest(
              `/locations/${this.locationId}/rooms/${room.roomId}/devices`
            );

            if (devicesResponse && devicesResponse.items) {
              for (const device of devicesResponse.items) {
                // Avoid duplicates
                if (!this.deviceList.find(d => d.id === device.deviceId)) {
                  this.deviceList.push({
                    id: device.deviceId,
                    name: device.label || device.name,
                    room: room.name
                  });
                }
              }
            }
          }
        }
      }
    }

    this.log("Resolved " + this.deviceList.length + " total devices", true);

    // Cache the device list
    this.updateCache({ devices: this.deviceList });
  },

  /**
   * Fetch status for a single device
   */
  fetchDeviceStatus: async function (deviceId) {
    return await this.apiRequest(`/devices/${deviceId}/status`);
  },

  /**
   * Make an API request with rate limiting and error handling
   */
  apiRequest: async function (endpoint) {
    // Apply backoff if needed
    if (this.backoffDelay > 0) {
      this.log("Applying backoff delay: " + this.backoffDelay + "ms", true);
      await this.delay(this.backoffDelay);
    }

    // Get access token
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      throw new Error("No access token available");
    }

    // Track request count
    this.requestCount++;
    if (this.requestCount >= this.RATE_WARNING) {
      console.warn("[MMM-STStatus] WARNING: Approaching rate limit (" + this.requestCount + "/" + this.RATE_LIMIT + ")");
    }

    const url = this.API_BASE + endpoint;
    this.log("API Request: " + endpoint, true);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": "Bearer " + accessToken,
        "Content-Type": "application/json"
      }
    });

    // Handle response status
    if (!response.ok) {
      await this.handleHttpError(response);
      return null;
    }

    // Reset backoff on success
    this.backoffDelay = 0;

    return await response.json();
  },

  /**
   * Handle HTTP error responses
   */
  handleHttpError: async function (response) {
    const status = response.status;
    let errorBody = "";
    
    try {
      errorBody = await response.text();
    } catch (e) {
      // Ignore read errors
    }

    switch (status) {
      case 400:
        // Check for invalid_grant in body
        if (errorBody.includes("invalid_grant")) {
          this.recordFailure("auth", "ALERT_AUTH");
          throw new Error("Invalid grant");
        }
        this.recordFailure("outage", "ALERT_OUTAGE");
        throw new Error("Bad request: " + status);

      case 401:
        // Auth failure - try to refresh tokens first (OAuth mode)
        if (this.oauthData && !this.authFailed) {
          console.warn("[MMM-STStatus] Auth error (HTTP " + status + "), attempting token refresh...");
          const refreshed = await this.refreshTokens();
          if (refreshed) {
            // Don't throw, let the caller retry
            throw new Error("Token refreshed, retry request");
          }
        }

        // Check for invalid_grant in body
        if (errorBody.includes("invalid_grant")) {
          this.recordFailure("auth", "ALERT_AUTH");
        } else {
          this.recordFailure("auth", "ALERT_AUTH");
        }

        // Auth failure - stop polling
        console.error("[MMM-STStatus] ERROR: Authentication failed (HTTP " + status + ")");
        this.authFailed = true;
        if (this.pollTimer) {
          clearInterval(this.pollTimer);
          this.pollTimer = null;
        }
        throw new Error("Authentication failed");

      case 403:
        // Permission/scope error
        this.recordFailure("scope", "ALERT_SCOPE");
        console.error("[MMM-STStatus] ERROR: Permission denied (HTTP " + status + ")");
        throw new Error("Permission denied");

      case 429:
        // Rate limited - exponential backoff
        this.backoffDelay = Math.min(this.backoffDelay ? this.backoffDelay * 2 : 1000, 30000);
        this.recordFailure("rateLimit", "ALERT_RATE_LIMIT");
        console.warn("[MMM-STStatus] WARNING: Rate limited, backing off for " + this.backoffDelay + "ms");
        throw new Error("Rate limited");

      case 500:
      case 502:
      case 503:
        // Server error - log and continue
        this.recordFailure("outage", "ALERT_OUTAGE");
        console.warn("[MMM-STStatus] WARNING: Server error (HTTP " + status + "), will retry");
        throw new Error("Server error: " + status);

      default:
        this.recordFailure("outage", "ALERT_OUTAGE");
        console.error("[MMM-STStatus] ERROR: HTTP " + status);
        throw new Error("HTTP error: " + status);
    }
  },

  /**
   * Handle general errors
   */
  handleError: function (err) {
    const message = err.message || "Unknown error";
    const code = err.code || "";
    
    console.error("[MMM-STStatus] ERROR: " + message);

    // Check for network errors
    if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "ENOTFOUND" || code === "ECONNRESET") {
      this.recordFailure("network", "ALERT_NETWORK");
      console.warn("[MMM-STStatus] Network error, using cached data if available");
      return;
    }

    // Check for network errors in message (node-fetch style)
    if (message.match(/ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|network/i)) {
      this.recordFailure("network", "ALERT_NETWORK");
      console.warn("[MMM-STStatus] Network error detected in message");
      return;
    }

    // For auth errors, already handled in handleHttpError
    if (message === "Authentication failed") {
      return;
    }

    // For token refresh retry, don't record as failure
    if (message === "Token refreshed, retry request") {
      return;
    }

    // For permission errors, already handled
    if (message === "Permission denied") {
      return;
    }

    // Generic/unknown errors
    this.recordFailure("outage", "ALERT_OUTAGE");
  },

  /**
   * Normalize device data for frontend
   * @returns {Object|null} Normalized device or null if parsing failed
   */
  normalizeDevice: function (device, status) {
    // Check for unexpected response shape
    if (!status || typeof status !== "object") {
      this.log("Schema error: status is not an object for device " + device.name, true);
      this.recordSchemaError();
      return null;
    }

    const normalized = {
      id: device.id,
      name: device.name,
      room: device.room,
      primaryCapability: null,
      primaryState: null
    };

    // Extract attributes from status
    if (status && status.components && status.components.main) {
      const main = status.components.main;

      // Debug: log all capabilities for this device
      if (this.config.debug) {
        this.log("Device " + device.name + " capabilities: " + Object.keys(main).join(", "));
      }

      // Priority order for primary capability
      const capabilityPriority = ["switch", "contactSensor", "contact", "motionSensor", "motion", "lock", "presenceSensor", "presence", "windowShade", "temperatureMeasurement", "battery"];

      for (const cap of capabilityPriority) {
        if (main[cap]) {
          normalized.primaryCapability = this.normalizeCapabilityName(cap);
          
          // Special handling for lock - extract lock state directly
          if (cap === "lock") {
            // Lock state is at main.lock.lock.value
            if (main.lock && main.lock.lock && main.lock.lock.value !== undefined) {
              normalized.primaryState = main.lock.lock.value;
              if (this.config.debug) {
                this.log("Device " + device.name + " lock state: " + normalized.primaryState);
              }
            } else {
              // Fallback to generic extraction
              normalized.primaryState = this.extractState(main[cap]);
            }
          }
          // Special handling for windowShade - use level as primary state, not commands
          else if (cap === "windowShade" || cap === "windowShadeLevel") {
            // Extract the shade level first, we'll set primaryState to the numeric level
            let shadeLevel = null;
            
            // Try windowShade.shadeLevel
            if (main.windowShade && main.windowShade.shadeLevel && 
                main.windowShade.shadeLevel.value !== undefined) {
              shadeLevel = main.windowShade.shadeLevel.value;
            }
            // Try windowShadeLevel.shadeLevel
            else if (main.windowShadeLevel && main.windowShadeLevel.shadeLevel && 
                     main.windowShadeLevel.shadeLevel.value !== undefined) {
              shadeLevel = main.windowShadeLevel.shadeLevel.value;
            }
            // Try switchLevel.level as fallback
            else if (main.switchLevel && main.switchLevel.level && 
                     main.switchLevel.level.value !== undefined) {
              shadeLevel = main.switchLevel.level.value;
            }
            
            // Store the numeric level as primaryState for blinds
            normalized.primaryState = shadeLevel;
            if (this.config.debug) {
              this.log("Device " + device.name + " blinds level: " + shadeLevel);
            }
          } else {
            normalized.primaryState = this.extractState(main[cap]);
          }
          break;
        }
      }

      // Extract secondary attributes - battery
      if (main.battery && main.battery.battery) {
        normalized.battery = main.battery.battery.value;
      }

      // Extract temperature from multiple possible capability names
      const tempCaps = ["temperatureMeasurement", "temperature"];
      for (const tempCap of tempCaps) {
        if (main[tempCap]) {
          // Try different attribute structures
          if (main[tempCap].temperature && main[tempCap].temperature.value !== undefined) {
            normalized.temperature = main[tempCap].temperature.value;
            if (this.config.debug) {
              this.log("Device " + device.name + " temperature: " + normalized.temperature);
            }
            break;
          }
          // Some devices use a direct value structure
          const tempValue = this.extractState(main[tempCap]);
          if (tempValue !== null && typeof tempValue === "number") {
            normalized.temperature = tempValue;
            if (this.config.debug) {
              this.log("Device " + device.name + " temperature (alt): " + normalized.temperature);
            }
            break;
          }
        }
      }

      // Extract humidity from multiple possible capability names
      const humidityCaps = ["relativeHumidityMeasurement", "humidity"];
      for (const humCap of humidityCaps) {
        if (main[humCap]) {
          if (main[humCap].humidity && main[humCap].humidity.value !== undefined) {
            normalized.humidity = main[humCap].humidity.value;
            break;
          }
          const humValue = this.extractState(main[humCap]);
          if (humValue !== null && typeof humValue === "number") {
            normalized.humidity = humValue;
            break;
          }
        }
      }

      // Extract window shade level (for blinds)
      if (main.windowShade) {
        if (main.windowShade.shadeLevel && main.windowShade.shadeLevel.value !== undefined) {
          normalized.level = main.windowShade.shadeLevel.value;
        }
      }
      if (main.windowShadeLevel) {
        if (main.windowShadeLevel.shadeLevel && main.windowShadeLevel.shadeLevel.value !== undefined) {
          normalized.level = main.windowShadeLevel.shadeLevel.value;
        }
      }
      // Also check switchLevel for blinds that use that capability
      if (main.switchLevel && normalized.level === undefined) {
        if (main.switchLevel.level && main.switchLevel.level.value !== undefined) {
          normalized.level = main.switchLevel.level.value;
        }
      }
    }

    // --- Temperature extraction across ALL components ---
    if (status && status.components) {
      for (const componentName in status.components) {
        const component = status.components[componentName];

        // temperatureMeasurement capability
        if (component.temperatureMeasurement &&
          component.temperatureMeasurement.temperature &&
          component.temperatureMeasurement.temperature.value !== undefined) {

          normalized.temperature =
            component.temperatureMeasurement.temperature.value;

          if (this.config.debug) {
            this.log(
              "Temperature from component '" + componentName +
              "': " + normalized.temperature
            );
          }
          break;
        }

        // Some devices expose temperature under 'temperature'
        if (component.temperature &&
          component.temperature.value !== undefined) {

          normalized.temperature = component.temperature.value;

          if (this.config.debug) {
            this.log(
              "Temperature (alt) from component '" + componentName +
              "': " + normalized.temperature
            );
          }
          break;
        }
      }
    }
    // Ensure thermostat temperature is preserved (Ecobee)
    if (
      normalized.temperature === undefined &&
      status &&
      status.components &&
      status.components.main
    ) {
      const main = status.components.main;

      if (
        main.thermostatTemperature &&
        main.thermostatTemperature.temperature &&
        main.thermostatTemperature.temperature.value !== undefined
      ) {
        normalized.temperature =
          main.thermostatTemperature.temperature.value;
      }
    }
    // --- Normalize SmartThings capabilities for extensibility ---
    normalized.capabilities = normalized.capabilities || {};

    if (status && status.components && status.components.main) {
      const main = status.components.main;

      // Temperature
      if (
        main.temperatureMeasurement &&
        main.temperatureMeasurement.temperature &&
        main.temperatureMeasurement.temperature.value !== undefined
      ) {
        normalized.capabilities.temperature =
          main.temperatureMeasurement.temperature.value;
      }

      // Humidity
      if (
        main.relativeHumidityMeasurement &&
        main.relativeHumidityMeasurement.humidity &&
        main.relativeHumidityMeasurement.humidity.value !== undefined
      ) {
        normalized.capabilities.humidity =
          main.relativeHumidityMeasurement.humidity.value;
      }

      // Thermostat operating state (vendor-agnostic)
      if (main.thermostatOperatingState) {
        // Try operatingState first (standard)
        if (
          main.thermostatOperatingState.thermostatOperatingState &&
          main.thermostatOperatingState.thermostatOperatingState.value
        ) {
          normalized.capabilities.thermostatOperatingState =
            main.thermostatOperatingState.thermostatOperatingState.value;
        }
        // Fallback to operatingState
        else if (
          main.thermostatOperatingState.operatingState &&
          main.thermostatOperatingState.operatingState.value
        ) {
          normalized.capabilities.thermostatOperatingState =
            main.thermostatOperatingState.operatingState.value;
        }
        
        if (this.config.debug && normalized.capabilities.thermostatOperatingState) {
          this.log("Thermostat operating state: " + normalized.capabilities.thermostatOperatingState);
        }
      }

      // Thermostat mode (heat / cool / auto / off)
      if (
        main.thermostatMode &&
        main.thermostatMode.thermostatMode &&
        main.thermostatMode.thermostatMode.value
      ) {
        normalized.capabilities.thermostatMode =
          main.thermostatMode.thermostatMode.value;
      }

      // Thermostat heating setpoint
      if (main.thermostatHeatingSetpoint) {
        if (this.config.debug) {
          this.log("thermostatHeatingSetpoint object: " + JSON.stringify(main.thermostatHeatingSetpoint));
        }
        if (
          main.thermostatHeatingSetpoint.heatingSetpoint &&
          main.thermostatHeatingSetpoint.heatingSetpoint.value !== undefined
        ) {
          normalized.heatingSetpoint =
            main.thermostatHeatingSetpoint.heatingSetpoint.value;
          normalized.capabilities.heatingSetpoint =
            main.thermostatHeatingSetpoint.heatingSetpoint.value;
          if (this.config.debug) {
            this.log("Heating setpoint: " + normalized.heatingSetpoint);
          }
        }
      }

      // Thermostat cooling setpoint
      if (main.thermostatCoolingSetpoint) {
        if (this.config.debug) {
          this.log("thermostatCoolingSetpoint object: " + JSON.stringify(main.thermostatCoolingSetpoint));
        }
        if (
          main.thermostatCoolingSetpoint.coolingSetpoint &&
          main.thermostatCoolingSetpoint.coolingSetpoint.value !== undefined
        ) {
          normalized.coolingSetpoint =
            main.thermostatCoolingSetpoint.coolingSetpoint.value;
          normalized.capabilities.coolingSetpoint =
            main.thermostatCoolingSetpoint.coolingSetpoint.value;
          if (this.config.debug) {
            this.log("Cooling setpoint: " + normalized.coolingSetpoint);
          }
        }
      }
    }
    return normalized;
  },

  /**
   * Normalize capability name
   */
  normalizeCapabilityName: function (cap) {
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
    return mapping[cap] || cap;
  },

  /**
   * Extract state value from capability data
   */
  extractState: function (capabilityData) {
    // Find the first attribute with a value
    for (const attr in capabilityData) {
      if (capabilityData[attr] && capabilityData[attr].value !== undefined) {
        return capabilityData[attr].value;
      }
    }
    return null;
  },

  /**
   * Rate limit management
   */
  checkRateLimit: function () {
    const now = Date.now();

    // Reset counter every minute
    if (!this.requestResetTime || now > this.requestResetTime) {
      this.resetRateLimit();
    }

    return this.requestCount < this.RATE_LIMIT;
  },

  resetRateLimit: function () {
    this.requestCount = 0;
    this.requestResetTime = Date.now() + 60000;
  },

  /**
   * Cache management
   */
  loadCache: function () {
    try {
      if (fs.existsSync(this.cacheFile)) {
        const data = fs.readFileSync(this.cacheFile, "utf8");
        this.cache = JSON.parse(data);

        // Check TTL
        const cacheAge = Date.now() - new Date(this.cache.timestamp).getTime();
        if (cacheAge > this.CACHE_TTL) {
          this.log("Cache expired, clearing", true);
          this.cache = null;
        } else {
          this.log("Cache loaded, age: " + Math.round(cacheAge / 1000 / 60) + " minutes", true);

          // Restore device list from cache
          if (this.cache.devices) {
            this.deviceList = this.cache.devices;
          }
          if (this.cache.locationId) {
            this.locationId = this.cache.locationId;
          }
        }
      }
    } catch (err) {
      this.log("Error loading cache: " + err.message);
      this.cache = null;
    }
  },

  updateCache: function (updates) {
    if (!this.cache) {
      this.cache = {
        timestamp: new Date().toISOString(),
        configHash: this.hashConfig(this.config)
      };
    }

    // Apply updates
    Object.assign(this.cache, updates, {
      timestamp: new Date().toISOString(),
      locationId: this.locationId
    });

    // Write to disk
    try {
      fs.writeFileSync(this.cacheFile, JSON.stringify(this.cache, null, 2));
      this.log("Cache updated", true);
    } catch (err) {
      this.log("Error writing cache: " + err.message);
    }
  },

  hashConfig: function (config) {
    const relevant = {
      clientId: config.clientId,
      token: config.token,
      devices: config.devices,
      rooms: config.rooms
    };
    return crypto.createHash("md5").update(JSON.stringify(relevant)).digest("hex");
  },

  // ============================================================================
  // Alert Management
  // ============================================================================

  /**
   * Record a failure and potentially trigger an alert
   * @param {string} type - Alert type: auth, scope, network, rateLimit, outage, schema
   * @param {string} messageKey - Translation key for the alert message
   */
  recordFailure: function (type, messageKey) {
    this.consecutiveFailures++;
    this.log("Failure recorded: " + type + " (count: " + this.consecutiveFailures + ")", true);

    // Auth and scope errors are critical - alert immediately
    if (type === "auth" || type === "scope") {
      this.setAlert(type, messageKey);
      return;
    }

    // Other errors wait for threshold
    if (this.consecutiveFailures >= this.FAILURE_THRESHOLD) {
      this.setAlert(type, messageKey);
    }
  },

  /**
   * Set an alert, respecting priority
   * @param {string} type - Alert type
   * @param {string} messageKey - Translation key for the alert message
   */
  setAlert: function (type, messageKey) {
    // Check if new alert has higher priority than current
    if (this.currentAlert) {
      const currentPriority = this.ALERT_PRIORITY.indexOf(this.currentAlert.type);
      const newPriority = this.ALERT_PRIORITY.indexOf(type);
      
      // Lower index = higher priority
      if (newPriority >= currentPriority && currentPriority !== -1) {
        this.log("Alert " + type + " ignored, current alert " + this.currentAlert.type + " has higher priority", true);
        return;
      }
    }

    this.currentAlert = { type: type, messageKey: messageKey };
    this.log("Alert set: " + type, true);

    // Send alert to frontend
    this.sendSocketNotification("ALERT", {
      type: type,
      messageKey: messageKey
    });
  },

  /**
   * Clear the current alert
   */
  clearAlert: function () {
    if (this.currentAlert) {
      this.log("Alert cleared: " + this.currentAlert.type, true);
      this.currentAlert = null;
      this.sendSocketNotification("ALERT_CLEAR", {});
    }
  },

  /**
   * Record a schema/parsing error
   * Called when API returns 200 but data cannot be parsed as expected
   */
  recordSchemaError: function () {
    this.recordFailure("schema", "ALERT_SCHEMA");
  },

  /**
   * Mock data for test mode
   */
  sendMockData: function () {
    const mockDevices = [
      { id: "1", name: "Living Room Lamp", room: "Living Room", primaryCapability: "switch", primaryState: "on" },
      { id: "2", name: "Front Door", room: "Entry", primaryCapability: "contact", primaryState: "closed" },
      { id: "3", name: "Back Door", room: "Kitchen", primaryCapability: "contact", primaryState: "open" },
      { id: "4", name: "Hallway Motion", room: "Hallway", primaryCapability: "motion", primaryState: "inactive" },
      { id: "5", name: "Living Room Motion", room: "Living Room", primaryCapability: "motion", primaryState: "active" },
      { id: "6", name: "Front Door Lock", room: "Entry", primaryCapability: "lock", primaryState: "locked" },
      { id: "7", name: "Back Door Lock", room: "Kitchen", primaryCapability: "lock", primaryState: "unlocked" },
      { id: "8", name: "Thermostat", room: "Living Room", primaryCapability: "temperature", primaryState: 72, battery: 85 },
      { id: "9", name: "Bedroom Sensor", room: "Bedroom", primaryCapability: "temperature", primaryState: 68, humidity: 45, battery: 15 },
      { id: "10", name: "Garage Door", room: "Garage", primaryCapability: "contact", primaryState: "closed", battery: 50 }
    ];

    // Clear any existing poller
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // Send initial mock data immediately
    this.sendSocketNotification("DEVICE_DATA", {
      devices: mockDevices,
      timestamp: new Date().toISOString()
    });

    // Reuse pollTimer for mock polling
    const interval = this.config.pollInterval || 60000;
    this.pollTimer = setInterval(() => {
      // Toggle one device to simulate activity
      mockDevices[4].primaryState =
        mockDevices[4].primaryState === "active" ? "inactive" : "active";

      this.sendSocketNotification("DEVICE_DATA", {
        devices: mockDevices,
        timestamp: new Date().toISOString()
      });
    }, interval);
  },

  /**
   * Utility functions
   */
  delay: function (ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  log: function (message, debugOnly) {
    if (debugOnly && !this.config.debug) return;
    console.log("[MMM-STStatus] " + message);
  }
});
