/* MMM-STStatus.js
 * MagicMirror² module for displaying SmartThings device status
 * 
 * By: Your Name
 * License: MIT
 */

Module.register("MMM-STStatus", {
  // Module requirements
  requiresVersion: "2.25.0",

  // Default configuration
  defaults: {
    token: "",                    // SmartThings Personal Access Token (required)
    devices: [],                  // Explicit device list: [{ id: "xxx", name: "Name" }]
    rooms: [],                    // Room names to include: ["Living Room", "Kitchen"]
    pollInterval: 60000,          // Polling interval in ms (default: 60 seconds)
    showLastUpdated: true,        // Show last updated timestamp
    temperatureUnit: "F",         // "F" or "C"
    defaultSort: "name",          // Sort by: "name", "room", "capability"
    debug: false,                 // Enable verbose logging
    testMode: false               // Use mock data instead of live API
  },

  // Capability to icon mapping
  CAPABILITY_ICONS: {
    switch: { on: "fa-lightbulb", off: "fa-lightbulb" },
    contact: { open: "fa-door-open", closed: "fa-door-closed" },
    motion: { active: "fa-person-walking", inactive: "fa-person" },
    lock: { locked: "fa-lock", unlocked: "fa-lock-open" },
    presence: { present: "fa-house-user", notPresent: "fa-house" },
    temperature: "fa-thermometer-half",
    humidity: "fa-droplet",
    blinds: { open: "fa-blinds-open", closed: "fa-blinds", partially: "fa-blinds" },
    level: "fa-sliders",
    battery: {
      high: "fa-battery-full",
      medium: "fa-battery-half",
      low: "fa-battery-quarter"
    }
  },

  // State color classes
  STATE_CLASSES: {
    on: "state-on",
    off: "state-off",
    open: "state-open",
    closed: "state-closed",
    locked: "state-locked",
    unlocked: "state-unlocked",
    active: "state-motion",
    inactive: "state-inactive",
    present: "state-home",
    notPresent: "state-away",
    partially: "state-partially"
  },

  // Module state
  deviceData: [],
  loading: true,
  error: null,
  lastUpdate: null,

  /**
   * Called when module starts
   */
  start: function() {
    Log.info("[MMM-STStatus] Starting module...");
    
    // Validate configuration
    if (!this.config.token && !this.config.testMode) {
      this.error = "No SmartThings token configured.";
      Log.error("[MMM-STStatus] ERROR: " + this.error);
      return;
    }

    if (this.config.devices.length === 0 && this.config.rooms.length === 0 && !this.config.testMode) {
      this.error = "No devices or rooms configured.";
      Log.error("[MMM-STStatus] ERROR: " + this.error);
      return;
    }

    // Send config to backend
    this.sendSocketNotification("SET_CONFIG", this.config);
  },

  /**
   * Load CSS styles
   */
getStyles: function () {
  return [
    this.file("node_modules/@fortawesome/fontawesome-free/css/all.min.css"),
    this.file("css/MMM-STStatus.css")
  ];
},

  /**
   * Handle socket notifications from node_helper
   */
  socketNotificationReceived: function(notification, payload) {
    if (this.config.debug) {
      Log.info("[MMM-STStatus] Received: " + notification);
    }

    switch (notification) {
      case "DEVICE_DATA":
        this.loading = false;
        this.error = null;
        this.deviceData = payload.devices || [];
        this.lastUpdate = payload.timestamp || new Date().toISOString();
        this.updateDom();
        break;

      case "ERROR":
        this.loading = false;
        this.error = payload.message || "Unknown error";
        Log.error("[MMM-STStatus] ERROR: " + this.error);
        // Keep showing old data if available
        if (payload.cached && payload.devices) {
          this.deviceData = payload.devices;
          this.lastUpdate = payload.timestamp;
        }
        this.updateDom();
        break;

      case "LOADING":
        this.loading = true;
        this.updateDom();
        break;
    }
  },

  /**
   * Generate the DOM for this module
   */
  getDom: function() {
    const wrapper = document.createElement("div");
    wrapper.className = "mmm-ststatus";

    // Show loading state
    if (this.loading && this.deviceData.length === 0) {
      wrapper.innerHTML = this.getLoadingHtml();
      return wrapper;
    }

    // Show error state (but still show cached data if available)
    if (this.error) {
      const errorDiv = document.createElement("div");
      errorDiv.className = "error-message";
      errorDiv.innerHTML = '<i class="fas fa-exclamation-triangle"></i> ' + this.error;
      wrapper.appendChild(errorDiv);
    }

    // Show device table
    if (this.deviceData.length > 0) {
      wrapper.appendChild(this.getDeviceTable());
    } else if (!this.error) {
      wrapper.innerHTML = '<div class="no-devices">No devices found</div>';
    }

    // Show last updated timestamp
    if (this.config.showLastUpdated && this.lastUpdate) {
      const footer = document.createElement("div");
      footer.className = "last-updated";
      footer.innerHTML = "Updated: " + this.formatTime(this.lastUpdate);
      wrapper.appendChild(footer);
    }

    return wrapper;
  },

  /**
   * Generate loading HTML
   */
  getLoadingHtml: function() {
    return '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Loading devices...</div>';
  },

  /**
   * Generate device table
   */
  getDeviceTable: function() {
    const table = document.createElement("table");
    table.className = "device-table";

    // Sort devices
    const sortedDevices = this.sortDevices(this.deviceData);

    // Create rows
    sortedDevices.forEach(device => {
      const row = this.createDeviceRow(device);
      table.appendChild(row);
    });

    return table;
  },

  /**
   * Create a row for a device
   */
  createDeviceRow: function(device) {
    const row = document.createElement("tr");
    row.className = "device-row";

    // Icon cell
    const iconCell = document.createElement("td");
    iconCell.className = "device-icon";
    iconCell.innerHTML = this.getDeviceIcon(device);
    row.appendChild(iconCell);

    // Name cell
    const nameCell = document.createElement("td");
    nameCell.className = "device-name";
    nameCell.textContent = device.name || device.label || "Unknown Device";
    row.appendChild(nameCell);

    // Primary status cell
    const statusCell = document.createElement("td");
    statusCell.className = "device-status";
    statusCell.innerHTML = this.getPrimaryStatus(device);
    row.appendChild(statusCell);

    // Secondary attributes cell
    const secondaryCell = document.createElement("td");
    secondaryCell.className = "device-secondary";
    secondaryCell.innerHTML = this.getSecondaryStatus(device);
    row.appendChild(secondaryCell);

    return row;
  },

  /**
   * Get the icon for a device based on its capability and state
   */
  getDeviceIcon: function(device) {
    const capability = device.primaryCapability;
    const state = device.primaryState;
    let iconClass = "fa-question";
    let stateClass = "";

    if (capability && this.CAPABILITY_ICONS[capability]) {
      const iconDef = this.CAPABILITY_ICONS[capability];
      
      if (typeof iconDef === "string") {
        iconClass = iconDef;
      } else if (typeof iconDef === "object") {
        // Handle battery levels
        if (capability === "battery" && typeof state === "number") {
          if (state > 60) iconClass = iconDef.high;
          else if (state >= 20) iconClass = iconDef.medium;
          else iconClass = iconDef.low;
        // Handle blinds based on level
        } else if (capability === "blinds" && device.level !== undefined) {
          if (device.level === 0) {
            iconClass = iconDef.closed;
            stateClass = "state-closed";
          } else if (device.level === 100) {
            iconClass = iconDef.open;
            stateClass = "state-open";
          } else {
            iconClass = iconDef.partially;
            stateClass = "state-partially";
          }
        } else {
          // Handle state-based icons
          iconClass = iconDef[state] || iconDef[Object.keys(iconDef)[0]];
        }
      }

      // Get state class for coloring
      if (!stateClass && state && this.STATE_CLASSES[state]) {
        stateClass = this.STATE_CLASSES[state];
      }
    }

    return '<i class="fas ' + iconClass + ' ' + stateClass + '"></i>';
  },

  /**
   * Get primary status display for a device
   */
  getPrimaryStatus: function(device) {
    const capability = device.primaryCapability;
    const state = device.primaryState;
    let displayValue = state || "—";
    let stateClass = "";

    // Normalize display values
    switch (capability) {
      case "switch":
        displayValue = state === "on" ? "ON" : "OFF";
        stateClass = state === "on" ? "state-on" : "state-off";
        break;
      case "contact":
        displayValue = state === "open" ? "OPEN" : "CLOSED";
        stateClass = state === "open" ? "state-open" : "state-closed";
        break;
      case "motion":
        displayValue = state === "active" ? "MOTION" : "—";
        stateClass = state === "active" ? "state-motion" : "state-inactive";
        break;
      case "lock":
        displayValue = state === "locked" ? "LOCKED" : "UNLOCKED";
        stateClass = state === "locked" ? "state-locked" : "state-unlocked";
        break;
      case "presence":
        displayValue = state === "present" ? "HOME" : "AWAY";
        stateClass = state === "present" ? "state-home" : "state-away";
        break;
      case "temperature":
        displayValue = this.formatTemperature(state);
        break;
      case "humidity":
        displayValue = state + "%";
        break;
      case "battery":
        displayValue = state + "%";
        if (state < 20) stateClass = "state-battery-low";
        break;
      case "level":
        displayValue = state + "%";
        break;
      case "blinds":
        // For blinds, show the level percentage if available
        if (device.level !== undefined && device.level !== null) {
          displayValue = device.level + "%";
          if (device.level === 0) stateClass = "state-closed";
          else if (device.level === 100) stateClass = "state-open";
          else stateClass = "state-partially";
        } else if (state === "open") {
          displayValue = "OPEN";
          stateClass = "state-open";
        } else if (state === "closed") {
          displayValue = "CLOSED";
          stateClass = "state-closed";
        } else {
          displayValue = state || "—";
        }
        break;
    }

    return '<span class="status-value ' + stateClass + '">' + displayValue + '</span>';
  },

  /**
   * Get secondary status attributes (battery, temperature, etc.)
   */
  getSecondaryStatus: function(device) {
    const parts = [];

    // Add battery if present and not primary
    if (device.battery !== undefined && device.primaryCapability !== "battery") {
      const batteryClass = device.battery < 20 ? "state-battery-low" : "";
      parts.push('<span class="secondary-item ' + batteryClass + '"><i class="fas fa-battery-half"></i> ' + device.battery + '%</span>');
    }

    // Add temperature if present and not primary
    if (device.temperature !== undefined && device.primaryCapability !== "temperature") {
      parts.push('<span class="secondary-item"><i class="fas fa-thermometer-half"></i> ' + this.formatTemperature(device.temperature) + '</span>');
    }

    // Add humidity if present and not primary
    if (device.humidity !== undefined && device.primaryCapability !== "humidity") {
      parts.push('<span class="secondary-item"><i class="fas fa-droplet"></i> ' + device.humidity + '%</span>');
    }

    return parts.join(" ");
  },

  /**
   * Format temperature based on config
   */
  formatTemperature: function(value) {
    if (value === undefined || value === null) return "—";
    
    const unit = this.config.temperatureUnit.toUpperCase();
    if (unit === "C") {
      // Assume SmartThings returns Fahrenheit, convert to Celsius
      const celsius = Math.round((value - 32) * 5 / 9);
      return celsius + "°C";
    }
    return Math.round(value) + "°F";
  },

  /**
   * Sort devices based on config
   */
  sortDevices: function(devices) {
    const sortBy = this.config.defaultSort;
    
    return devices.slice().sort((a, b) => {
      switch (sortBy) {
        case "room":
          return (a.room || "").localeCompare(b.room || "");
        case "capability":
          return (a.primaryCapability || "").localeCompare(b.primaryCapability || "");
        case "name":
        default:
          return (a.name || "").localeCompare(b.name || "");
      }
    });
  },

  /**
   * Format timestamp for display
   */
  formatTime: function(isoString) {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
});
