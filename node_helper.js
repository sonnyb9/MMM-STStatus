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
  RATE_LIMIT: 250,
  RATE_WARNING: 200,

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
  CACHE_TTL: 24 * 60 * 60 * 1000,

  start: function () {
    console.log("[MMM-STStatus] Node helper started");
    this.cacheFile = path.join(__dirname, "MMM-STStatus.cache.json");
    this.resetRateLimit();
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification === "SET_CONFIG") {
      this.config = payload;
      this.log("Config received", true);
      this.initialize();
    }
  },

  initialize: async function () {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    this.loadCache();

    const configHash = this.hashConfig(this.config);
    if (this.cache && this.cache.configHash !== configHash) {
      this.log("Config changed, invalidating cache", true);
      this.cache = null;
    }

    if (this.config.testMode) {
      this.log("Test mode enabled, using mock data");
      this.sendMockData();
      return;
    }

    if (this.cache && this.cache.lastStatus) {
      this.sendSocketNotification("DEVICE_DATA", {
        devices: this.cache.lastStatus,
        timestamp: this.cache.timestamp
      });
    }

    this.sendSocketNotification("LOADING", {});
    await this.fetchDevices();
    this.startPolling();
  },

  startPolling: function () {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }

    const interval = Math.max(this.config.pollInterval || 60000, 30000);
    this.pollTimer = setInterval(() => this.fetchDevices(), interval);
  },

  fetchDevices: async function () {
    try {
      if (this.deviceList.length === 0) {
        await this.resolveDevices();
      }

      const devices = [];

      for (const device of this.deviceList) {
        if (!this.checkRateLimit()) {
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

      this.updateCache({ lastStatus: devices });

      this.sendSocketNotification("DEVICE_DATA", {
        devices,
        timestamp: new Date().toISOString()
      });

    } catch (err) {
      this.handleError(err);
    }
  },

  fetchDeviceStatus: async function (deviceId) {
    return this.apiRequest(`/devices/${deviceId}/status`);
  },

  apiRequest: async function (endpoint) {
    if (!this.checkRateLimit()) {
      throw new Error("Rate limit exceeded");
    }

    if (this.backoffDelay > 0) {
      await this.delay(this.backoffDelay);
    }

    this.requestCount++;

    const response = await fetch(this.API_BASE + endpoint, {
      headers: {
        "Authorization": "Bearer " + this.config.token,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      await this.handleHttpError(response);
      return null;
    }

    this.backoffDelay = 0;
    return response.json();
  },

  handleHttpError: async function (response) {
    if (response.status === 429) {
      this.backoffDelay = Math.min(this.backoffDelay ? this.backoffDelay * 2 : 1000, 30000);
      throw new Error("Rate limited");
    }

    if (response.status === 401 || response.status === 403) {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }

      this.sendSocketNotification("ERROR", {
        message: "Authentication failed",
        cached: !!this.cache,
        devices: this.cache?.lastStatus,
        timestamp: this.cache?.timestamp
      });

      throw new Error("Authentication failed");
    }

    throw new Error("HTTP error " + response.status);
  },

  loadCache: function () {
    try {
      if (!fs.existsSync(this.cacheFile)) return;

      const data = JSON.parse(fs.readFileSync(this.cacheFile));
      const age = Date.now() - new Date(data.timestamp).getTime();

      if (age > this.CACHE_TTL) {
        this.cache = null;
        return;
      }

      this.cache = data;
      this.deviceList = data.devices || [];
      this.locationId = data.locationId || null;

    } catch (err) {
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

    Object.assign(this.cache, updates, {
      timestamp: new Date().toISOString(),
      locationId: this.locationId
    });

    fs.writeFileSync(this.cacheFile, JSON.stringify(this.cache, null, 2));
  },

  hashConfig: function (config) {
    return crypto
      .createHash("md5")
      .update(JSON.stringify({
        token: config.token,
        devices: config.devices,
        rooms: config.rooms
      }))
      .digest("hex");
  },

  sendMockData: function () {
    const mockDevices = [
      { id: "1", name: "Living Room Lamp", primaryCapability: "switch", primaryState: "on" },
      { id: "2", name: "Front Door", primaryCapability: "contact", primaryState: "closed" }
    ];

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }

    this.pollTimer = setInterval(() => {
      this.sendSocketNotification("DEVICE_DATA", {
        devices: mockDevices,
        timestamp: new Date().toISOString()
      });
    }, this.config.pollInterval || 60000);
  },

  delay: function (ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  log: function (message, debugOnly) {
    if (debugOnly && !this.config.debug) return;
    console.log("[MMM-STStatus] " + message);
  }

});
