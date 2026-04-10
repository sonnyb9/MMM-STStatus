#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadOAuthData, saveOAuthData, tokensNeedRefresh } = require("./oauth-utils");

const MODULE_DIR = __dirname;
const API_BASE = "https://api.smartthings.com/v1";
const TOKEN_URL = "https://api.smartthings.com/oauth/token";
const DEFAULT_MM_CONFIG = path.resolve(MODULE_DIR, "../../config/config.js");
const CACHE_FILE = path.join(MODULE_DIR, ".cache.json");

function parseArgs(argv) {
  const options = {
    all: false,
    raw: false,
    debug: false,
    configPath: DEFAULT_MM_CONFIG
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--all") {
      options.all = true;
    } else if (arg === "--raw") {
      options.raw = true;
    } else if (arg === "--debug") {
      options.debug = true;
    } else if (arg === "--config" && argv[i + 1]) {
      options.configPath = path.resolve(argv[++i]);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log("Usage: node test-smartthings.js [--all] [--raw] [--debug] [--config /path/to/config.js]");
  console.log("");
  console.log("Checks SmartThings API connectivity and prints current device status.");
  console.log("");
  console.log("Options:");
  console.log("  --all      Ignore MagicMirror config and fetch all devices from SmartThings");
  console.log("  --raw      Print normalized JSON instead of the text summary");
  console.log("  --debug    Print extra request and discovery details");
  console.log("  --config   Path to MagicMirror config.js (default: ../../config/config.js)");
}

function logDebug(enabled, message) {
  if (enabled) {
    console.log(`[debug] ${message}`);
  }
}

function loadMagicMirrorConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    return null;
  }

  const source = fs.readFileSync(configPath, "utf8");
  const script = new vm.Script(`${source}\nmodule.exports = config;`, {
    filename: configPath
  });
  const context = {
    module: { exports: {} },
    exports: {},
    require,
    __dirname: path.dirname(configPath),
    __filename: configPath,
    console,
    process
  };

  script.runInNewContext(context);
  return context.module.exports || null;
}

function getModuleDeviceConfig(mmConfig) {
  if (!mmConfig || !Array.isArray(mmConfig.modules)) {
    return [];
  }

  const mod = mmConfig.modules.find((entry) => entry && entry.module === "MMM-STStatus");
  if (!mod || !mod.config || !Array.isArray(mod.config.devices)) {
    return [];
  }

  return mod.config.devices
    .filter((device) => device && device.id)
    .map((device) => ({
      id: device.id,
      name: device.name || device.id,
      room: device.room || null
    }));
}

function hashConfig(config) {
  const relevant = {
    clientId: config && config.clientId,
    token: config && config.token,
    devices: config && config.devices,
    rooms: config && config.rooms
  };

  return require("crypto")
    .createHash("md5")
    .update(JSON.stringify(relevant))
    .digest("hex");
}

function loadExistingCache() {
  if (!fs.existsSync(CACHE_FILE)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function updateCache(mmConfig, configuredDevices, successfulStatuses) {
  const stModule =
    mmConfig && Array.isArray(mmConfig.modules)
      ? mmConfig.modules.find((entry) => entry && entry.module === "MMM-STStatus")
      : null;
  const moduleConfig = stModule && stModule.config ? stModule.config : {};
  const existing = loadExistingCache() || {};

  const nextCache = {
    ...existing,
    timestamp: new Date().toISOString(),
    configHash: hashConfig(moduleConfig),
    devices: configuredDevices.length > 0 ? configuredDevices : existing.devices,
    lastStatus: successfulStatuses,
    locationId: existing.locationId || null
  };

  fs.writeFileSync(CACHE_FILE, JSON.stringify(nextCache, null, 2));
  return nextCache;
}

async function refreshTokensIfNeeded(oauthData, debug) {
  if (!tokensNeedRefresh(oauthData, 600)) {
    return oauthData;
  }

  logDebug(debug, "Refreshing expired or near-expiry OAuth token");

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: oauthData.refresh_token,
    client_id: oauthData.clientId
  });

  const basicAuth = Buffer.from(
    `${oauthData.clientId}:${oauthData.clientSecret}`
  ).toString("base64");

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${basicAuth}`
    },
    body: params.toString()
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Token refresh failed (HTTP ${response.status}): ${body}`);
  }

  const refreshed = await response.json();
  const updated = {
    ...oauthData,
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token || oauthData.refresh_token,
    token_type: refreshed.token_type || "Bearer",
    scope: refreshed.scope || oauthData.scope,
    expiresAt: new Date(Date.now() + (refreshed.expires_in || 86400) * 1000).toISOString(),
    obtainedAt: new Date().toISOString()
  };

  if (!saveOAuthData(MODULE_DIR, updated)) {
    throw new Error("Failed to persist refreshed OAuth data");
  }

  return updated;
}

async function apiRequest(accessToken, endpoint, debug) {
  const url = `${API_BASE}${endpoint}`;
  logDebug(debug, `GET ${url}`);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`SmartThings API error ${response.status} on ${endpoint}: ${body}`);
  }

  return response.json();
}

async function fetchAllDevices(accessToken, debug) {
  const response = await apiRequest(accessToken, "/devices", debug);
  const items = Array.isArray(response.items) ? response.items : [];

  return items.map((device) => ({
    id: device.deviceId,
    name: device.label || device.name || device.deviceId,
    room: device.roomName || null
  }));
}

function normalizeCapabilityName(capability) {
  const mapping = {
    temperatureMeasurement: "temperature",
    relativeHumidityMeasurement: "humidity",
    contactSensor: "contact",
    motionSensor: "motion",
    presenceSensor: "presence",
    windowShade: "blinds",
    windowShadeLevel: "blinds",
    switchLevel: "level"
  };

  return mapping[capability] || capability;
}

function extractState(capabilityData) {
  for (const attr in capabilityData) {
    if (capabilityData[attr] && capabilityData[attr].value !== undefined) {
      return capabilityData[attr].value;
    }
  }

  return null;
}

function normalizeDevice(device, status) {
  const normalized = {
    id: device.id,
    name: device.name,
    room: device.room || null,
    primaryCapability: null,
    primaryState: null,
    capabilities: {}
  };

  if (!status || !status.components || !status.components.main) {
    return normalized;
  }

  const main = status.components.main;
  const capabilityPriority = [
    "switch",
    "contactSensor",
    "contact",
    "motionSensor",
    "motion",
    "lock",
    "presenceSensor",
    "presence",
    "windowShade",
    "temperatureMeasurement",
    "battery"
  ];

  for (const capability of capabilityPriority) {
    if (!main[capability]) {
      continue;
    }

    normalized.primaryCapability = normalizeCapabilityName(capability);

    if (capability === "lock" && main.lock && main.lock.lock) {
      normalized.primaryState = main.lock.lock.value;
    } else if (capability === "windowShade" || capability === "windowShadeLevel") {
      normalized.primaryState =
        main.windowShade?.shadeLevel?.value ??
        main.windowShadeLevel?.shadeLevel?.value ??
        main.switchLevel?.level?.value ??
        extractState(main[capability]);
    } else {
      normalized.primaryState = extractState(main[capability]);
    }

    break;
  }

  if (main.battery?.battery?.value !== undefined) {
    normalized.battery = main.battery.battery.value;
    normalized.capabilities.battery = normalized.battery;
  }

  if (main.temperatureMeasurement?.temperature?.value !== undefined) {
    normalized.temperature = main.temperatureMeasurement.temperature.value;
    normalized.capabilities.temperature = normalized.temperature;
  } else if (main.thermostatTemperature?.temperature?.value !== undefined) {
    normalized.temperature = main.thermostatTemperature.temperature.value;
    normalized.capabilities.temperature = normalized.temperature;
  }

  if (normalized.primaryCapability === "temperature" && normalized.primaryState == null) {
    normalized.primaryState = normalized.temperature ?? null;
  }

  if (main.relativeHumidityMeasurement?.humidity?.value !== undefined) {
    normalized.humidity = main.relativeHumidityMeasurement.humidity.value;
    normalized.capabilities.humidity = normalized.humidity;
  }

  if (main.thermostatOperatingState?.thermostatOperatingState?.value) {
    normalized.capabilities.thermostatOperatingState =
      main.thermostatOperatingState.thermostatOperatingState.value;
  } else if (main.thermostatOperatingState?.operatingState?.value) {
    normalized.capabilities.thermostatOperatingState =
      main.thermostatOperatingState.operatingState.value;
  }

  if (main.thermostatMode?.thermostatMode?.value) {
    normalized.capabilities.thermostatMode = main.thermostatMode.thermostatMode.value;
  }

  if (main.thermostatHeatingSetpoint?.heatingSetpoint?.value !== undefined) {
    normalized.heatingSetpoint = main.thermostatHeatingSetpoint.heatingSetpoint.value;
    normalized.capabilities.heatingSetpoint = normalized.heatingSetpoint;
  }

  if (main.thermostatCoolingSetpoint?.coolingSetpoint?.value !== undefined) {
    normalized.coolingSetpoint = main.thermostatCoolingSetpoint.coolingSetpoint.value;
    normalized.capabilities.coolingSetpoint = normalized.coolingSetpoint;
  }

  if (main.windowShade?.shadeLevel?.value !== undefined) {
    normalized.level = main.windowShade.shadeLevel.value;
    normalized.capabilities.level = normalized.level;
  } else if (main.windowShadeLevel?.shadeLevel?.value !== undefined) {
    normalized.level = main.windowShadeLevel.shadeLevel.value;
    normalized.capabilities.level = normalized.level;
  } else if (main.switchLevel?.level?.value !== undefined) {
    normalized.level = main.switchLevel.level.value;
    normalized.capabilities.level = normalized.level;
  }

  return normalized;
}

function formatStatus(device) {
  const parts = [];
  parts.push(`${device.name} (${device.id})`);

  if (device.room) {
    parts.push(`room=${device.room}`);
  }

  if (device.primaryCapability) {
    parts.push(`primary=${device.primaryCapability}:${device.primaryState}`);
  }

  if (device.temperature !== undefined) {
    parts.push(`temp=${device.temperature}`);
  }

  if (device.humidity !== undefined) {
    parts.push(`humidity=${device.humidity}%`);
  }

  if (device.level !== undefined) {
    parts.push(`level=${device.level}%`);
  }

  if (device.battery !== undefined) {
    parts.push(`battery=${device.battery}%`);
  }

  if (device.capabilities.thermostatMode) {
    parts.push(`mode=${device.capabilities.thermostatMode}`);
  }

  if (device.capabilities.thermostatOperatingState) {
    parts.push(`hvac=${device.capabilities.thermostatOperatingState}`);
  }

  if (device.heatingSetpoint !== undefined) {
    parts.push(`heat=${device.heatingSetpoint}`);
  }

  if (device.coolingSetpoint !== undefined) {
    parts.push(`cool=${device.coolingSetpoint}`);
  }

  return parts.join(" | ");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const oauthData = loadOAuthData(MODULE_DIR);

  if (!oauthData) {
    throw new Error("No OAuth data found. Run node setup.js first.");
  }

  if (!oauthData.clientId || !oauthData.clientSecret || !oauthData.access_token) {
    throw new Error("OAuth data is incomplete. Run node setup.js again.");
  }

  const activeOAuth = await refreshTokensIfNeeded(oauthData, options.debug);
  const mmConfig = !options.all ? loadMagicMirrorConfig(options.configPath) : null;
  let devices = [];

  if (!options.all) {
    devices = getModuleDeviceConfig(mmConfig);
    logDebug(options.debug, `Loaded ${devices.length} configured devices from ${options.configPath}`);
  }

  if (devices.length === 0) {
    devices = await fetchAllDevices(activeOAuth.access_token, options.debug);
    logDebug(options.debug, `Discovered ${devices.length} devices from SmartThings`);
  }

  const results = [];

  for (const device of devices) {
    try {
      const status = await apiRequest(activeOAuth.access_token, `/devices/${device.id}/status`, options.debug);
      results.push(normalizeDevice(device, status));
    } catch (error) {
      results.push({
        id: device.id,
        name: device.name || device.id,
        room: device.room || null,
        error: error.message
      });
    }
  }

  const successfulStatuses = results.filter((result) => !result.error);
  updateCache(mmConfig, devices, successfulStatuses);

  if (options.raw) {
    console.log(JSON.stringify({
      checkedAt: new Date().toISOString(),
      deviceCount: results.length,
      devices: results
    }, null, 2));
    return;
  }

  console.log(`SmartThings check completed at ${new Date().toISOString()}`);
  console.log(`Devices checked: ${results.length}`);
  console.log(`Successful updates: ${successfulStatuses.length}`);
  console.log(`Cache updated: ${CACHE_FILE}`);
  console.log("");

  for (const result of results) {
    if (result.error) {
      console.log(`ERROR | ${result.name} (${result.id}) | ${result.error}`);
    } else {
      console.log(formatStatus(result));
    }
  }
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
