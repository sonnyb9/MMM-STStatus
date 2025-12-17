/* node_helper.js
 * Backend helper for MMM-STStatus
 * Handles SmartThings API communication, caching, and rate limiting
 */

const NodeHelper = require("node_helper");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

module.exports = NodeHelper.create({
  // Configuration
  config: null,

  // API settings
  API_BASE: "https://api.smartthings.com/v1",
  RATE_LIMIT: 250,           // requests per minute
  RATE_WARNING: 200,         // warn at this threshold

  // State
  requestCount: 0,
  requestResetTime: null,
  pollTimer: null,
  backoffDelay: 0,
  locationId: null,
  deviceList: [],

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
   * * Handle socket notifications from frontend 
   * */
  socketNotificationReceived: function (notification, payload) {
    if (notification === "SET_CONFIG") {
      this.config = payload;

      console.log(
        "[MMM-STStatus] Token received:",
        this.config && this.config.token
          ? this.config.token.slice(0, 6) + "…"
          : "MISSING"
      );

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
            devices.push(this.normalizeDevice(device, status));
          }
        } catch (err) {
          this.log("Error fetching device " + device.id + ": " + err.message);
        }
      }

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
        "Authorization": "Bearer " + this.config.token,
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

    switch (status) {
      case 401:
      case 403:
        // Auth failure - stop polling
        console.error("[MMM-STStatus] ERROR: Authentication failed (HTTP " + status + ")");
        this.authFailed = true;
        if (this.pollTimer) {
          clearInterval(this.pollTimer);
          this.pollTimer = null;
        }
        this.sendSocketNotification("ERROR", {
          message: "SmartThings authentication failed. Check your Personal Access Token.",
          cached: !!this.cache,
          devices: this.cache ? this.cache.lastStatus : null,
          timestamp: this.cache ? this.cache.timestamp : null
        });
        throw new Error("Authentication failed");

      case 429:
        // Rate limited - exponential backoff
        this.backoffDelay = Math.min(this.backoffDelay ? this.backoffDelay * 2 : 1000, 30000);
        console.warn("[MMM-STStatus] WARNING: Rate limited, backing off for " + this.backoffDelay + "ms");
        throw new Error("Rate limited");

      case 500:
      case 502:
      case 503:
        // Server error - log and continue
        console.warn("[MMM-STStatus] WARNING: Server error (HTTP " + status + "), will retry");
        throw new Error("Server error: " + status);

      default:
        console.error("[MMM-STStatus] ERROR: HTTP " + status);
        throw new Error("HTTP error: " + status);
    }
  },

  /**
   * Handle general errors
   */
  handleError: function (err) {
    const message = err.message || "Unknown error";
    console.error("[MMM-STStatus] ERROR: " + message);

    // Check for network errors
    if (err.code === "ECONNREFUSED" || err.code === "ETIMEDOUT" || err.code === "ENOTFOUND") {
      console.warn("[MMM-STStatus] Network error, using cached data if available");
      this.sendSocketNotification("ERROR", {
        message: "Unable to reach SmartThings. Showing cached data.",
        cached: !!this.cache,
        devices: this.cache ? this.cache.lastStatus : null,
        timestamp: this.cache ? this.cache.timestamp : null
      });
      return;
    }

    // For auth errors, the message was already sent
    if (message === "Authentication failed") {
      return;
    }

    // For other errors, continue polling but notify frontend
    if (this.cache && this.cache.lastStatus) {
      this.sendSocketNotification("ERROR", {
        message: "Error fetching data. Showing cached data.",
        cached: true,
        devices: this.cache.lastStatus,
        timestamp: this.cache.timestamp
      });
    }
  },

  /**
   * Normalize device data for frontend
   */
  normalizeDevice: function (device, status) {
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
      if (
        main.thermostatOperatingState &&
        main.thermostatOperatingState.operatingState &&
        main.thermostatOperatingState.operatingState.value
      ) {
        normalized.capabilities.thermostatOperatingState =
          main.thermostatOperatingState.operatingState.value;
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
      token: config.token,
      devices: config.devices,
      rooms: config.rooms
    };
    return crypto.createHash("md5").update(JSON.stringify(relevant)).digest("hex");
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
