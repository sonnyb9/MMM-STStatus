#!/usr/bin/env node

/**
 * setup.js - Interactive setup script for MMM-STStatus
 * 
 * This script guides you through the complete setup process:
 * 1. OAuth authorization with SmartThings
 * 2. Selecting MagicMirror display position
 * 3. Selecting your SmartThings location
 * 4. Selecting rooms and devices to display
 * 5. Configuring display options
 * 6. Generating a ready-to-paste config block
 * 
 * Prerequisites:
 * - SmartThings account
 * - OAuth app created via SmartThings CLI (smartthings apps:create)
 * 
 * Usage: node setup.js [--dry-run]
 */

const readline = require("readline");
const https = require("https");
const { URL, URLSearchParams } = require("url");
const path = require("path");
const {
  saveOAuthData,
  loadOAuthData,
  tokensNeedRefresh,
  getDataFilePath
} = require("./oauth-utils");

// SmartThings OAuth endpoints
const AUTH_URL = "https://api.smartthings.com/oauth/authorize";
const TOKEN_URL = "https://api.smartthings.com/oauth/token";
const API_BASE = "https://api.smartthings.com/v1";
const REDIRECT_URI = "https://httpbin.org/get";

// Scopes needed for device monitoring
const SCOPES = [
  "r:devices:*",      // Read device information
  "x:devices:*",      // Execute device commands (for future use)
  "r:locations:*"     // Read location information
].join(" ");

// Valid MagicMirror positions
const VALID_POSITIONS = [
  "top_bar", "top_left", "top_center", "top_right",
  "upper_third", "middle_center", "lower_third",
  "bottom_left", "bottom_center", "bottom_right", "bottom_bar",
  "fullscreen_above", "fullscreen_below"
];

// Module directory
const MODULE_DIR = __dirname;

// State
let dryRun = process.argv.includes("--dry-run");
let clientId = null;
let clientSecret = null;
let accessToken = null;

// Readline interface
let rl = null;

/**
 * Main entry point
 */
async function main() {
  console.log("");
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║              MMM-STStatus Setup Wizard                         ║");
  console.log("╠════════════════════════════════════════════════════════════════╣");
  console.log("║  This wizard will guide you through:                           ║");
  console.log("║  1. OAuth authentication with SmartThings                      ║");
  console.log("║  2. Device and room selection                                  ║");
  console.log("║  3. Display configuration                                      ║");
  console.log("║  4. Generating your config.js entry                            ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log("");

  if (dryRun) {
    console.log("📋 DRY RUN MODE - No files will be modified\n");
  }

  rl = createReadline();

  try {
    // Step 1: OAuth Setup
    await setupOAuth();
    
    // Step 2: Get position
    const position = await promptForPosition();
    
    // Step 3: Select location
    const location = await selectLocation();
    
    // Step 4: Select rooms
    const rooms = await selectRooms(location.locationId);
    
    // Step 5: Select devices from rooms
    const devices = await selectDevices(location.locationId, rooms);
    
    // Step 6: Additional options
    const options = await promptForOptions();
    
    // Step 7: Generate config
    const config = generateConfig(position, rooms, devices, options);
    
    // Step 8: Output config
    outputConfig(config);
    
  } catch (err) {
    if (err.message === "USER_CANCELLED") {
      console.log("\n👋 Setup cancelled. No changes were made.");
    } else {
      console.error("\n❌ Error:", err.message);
      if (process.env.DEBUG) {
        console.error(err.stack);
      }
    }
  }

  rl.close();
}

// ============================================================================
// OAuth Setup Functions
// ============================================================================

/**
 * Handle OAuth authentication setup
 */
async function setupOAuth() {
  console.log("Step 1: OAuth Authentication");
  console.log("════════════════════════════════════════════════════════════════");
  console.log("");
  console.log("Before running this setup, you need to create an OAuth app using");
  console.log("the SmartThings CLI. If you haven't done this yet, see README.md for");
  console.log("detailed instructions, or follow the quick steps below:");
  console.log("");
  console.log("  1. Install SmartThings CLI (see README.md for platform-specific instructions)");
  console.log("");
  console.log("  2. Run: smartthings apps:create");
  console.log("     - App Type: API Access");
  console.log("     - Scopes: r:devices:*, x:devices:*, r:locations:*");
  console.log("     - Redirect URI: https://httpbin.org/get");
  console.log("");
  console.log("  3. Save your Client ID and Client Secret");
  console.log("");
  
  // Get Client ID
  clientId = await prompt("Enter your OAuth Client ID: ");
  
  if (!clientId) {
    throw new Error("Client ID is required");
  }
  
  // Validate Client ID format (should be UUID)
  if (!isValidUUID(clientId)) {
    console.warn("\n⚠️  Warning: Client ID doesn't appear to be a valid UUID format.");
    const cont = await prompt("Continue anyway? (y/n): ");
    if (cont.toLowerCase() !== "y") {
      throw new Error("USER_CANCELLED");
    }
  }
  
  // Get Client Secret
  console.log("");
  console.log("Note: Your input will be visible. Make sure no one is watching.");
  clientSecret = await prompt("Enter your OAuth Client Secret: ");
  
  if (!clientSecret) {
    throw new Error("Client Secret is required");
  }
  
  // Check for existing valid OAuth data
  const existingData = loadOAuthData(MODULE_DIR);
  
  if (existingData && existingData.access_token) {
    // Check if existing data has same credentials
    if (existingData.clientId === clientId && existingData.clientSecret === clientSecret) {
      console.log("");
      console.log("✅ Found existing OAuth data.");
      
      // Test if tokens still work
      console.log("   Testing token validity...");
      accessToken = existingData.access_token;
      try {
        await apiRequest("/locations");
        console.log("   Tokens are valid!");
        
        const reauth = await prompt("\nDo you want to re-authorize anyway? (y/N): ");
        if (reauth.toLowerCase() !== "y") {
          console.log("");
          return; // Skip OAuth, use existing tokens
        }
      } catch (err) {
        console.log("   Tokens are expired or invalid. Need to re-authorize.");
      }
    } else {
      console.log("");
      console.log("⚠️  Existing OAuth data found but credentials differ. Will re-authorize.");
    }
  }
  
  // Perform OAuth authorization
  await performOAuthFlow();
}

/**
 * Perform the OAuth authorization flow
 */
async function performOAuthFlow() {
  console.log("");
  console.log("─".repeat(60));
  console.log("OAuth Authorization");
  console.log("─".repeat(60));
  
  const state = Math.random().toString(36).substring(2, 15);
  const authUrl = generateAuthUrl(state);
  
  console.log("");
  console.log("Open this URL in your browser to authorize:");
  console.log("");
  console.log(authUrl);
  console.log("");
  console.log("⚠️  This URL expires quickly - complete authorization within a few minutes.");
  console.log("");
  console.log("After authorizing, you'll be redirected to httpbin.org.");
  console.log("The page will show JSON data - that's expected!");
  console.log("");
  console.log("Copy the ENTIRE URL from your browser's address bar.");
  console.log("It will look like: https://httpbin.org/get?code=XXXXX&state=XXXXX");
  console.log("");
  
  const redirectUrl = await prompt("Paste the redirect URL here: ");
  
  if (!redirectUrl) {
    throw new Error("Redirect URL is required");
  }
  
  // Extract code from URL
  const { code, state: returnedState } = extractCodeFromUrl(redirectUrl);
  
  // Verify state
  if (returnedState && returnedState !== state) {
    console.warn("\n⚠️  Warning: State mismatch. This could indicate a security issue.");
    const cont = await prompt("Continue anyway? (y/n): ");
    if (cont.toLowerCase() !== "y") {
      throw new Error("USER_CANCELLED");
    }
  }
  
  console.log("");
  console.log("Exchanging authorization code for tokens...");
  
  // Exchange code for tokens
  const tokens = await exchangeCodeForTokens(code);
  
  // Store access token for API calls
  accessToken = tokens.access_token;
  
  // Prepare OAuth data for storage (includes credentials + tokens)
  const oauthData = {
    clientId: clientId,
    clientSecret: clientSecret,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_type: tokens.token_type || "Bearer",
    scope: tokens.scope || SCOPES,
    expiresAt: new Date(Date.now() + (tokens.expires_in || 86400) * 1000).toISOString(),
    obtainedAt: new Date().toISOString()
  };
  
  // Save encrypted OAuth data
  if (!dryRun) {
    console.log("Saving encrypted OAuth data...");
    const success = saveOAuthData(MODULE_DIR, oauthData);
    if (success) {
      console.log(`✅ OAuth data saved to: ${getDataFilePath(MODULE_DIR)}`);
    } else {
      console.error("❌ Failed to save OAuth data");
    }
  } else {
    console.log("📋 DRY RUN: OAuth data would be saved (skipped)");
  }
  
  console.log("");
}

/**
 * Generate OAuth authorization URL
 */
function generateAuthUrl(state) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    state: state
  });
  
  return `${AUTH_URL}?${params.toString()}`;
}

/**
 * Extract authorization code from redirect URL
 */
function extractCodeFromUrl(redirectUrl) {
  try {
    // Handle case where user pastes just the code
    if (!redirectUrl.includes("://") && !redirectUrl.includes("?")) {
      return { code: redirectUrl, state: null };
    }
    
    const url = new URL(redirectUrl);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const errorDesc = url.searchParams.get("error_description");
    
    if (error) {
      throw new Error(`Authorization error: ${error} - ${errorDesc || "Unknown error"}`);
    }
    
    if (!code) {
      throw new Error("No authorization code found in URL");
    }
    
    return { code, state };
  } catch (err) {
    if (err.message.includes("Authorization error") || err.message.includes("No authorization code")) {
      throw err;
    }
    throw new Error(`Failed to parse redirect URL: ${err.message}`);
  }
}

/**
 * Exchange authorization code for tokens
 */
function exchangeCodeForTokens(code) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      grant_type: "authorization_code",
      code: code,
      client_id: clientId,
      redirect_uri: REDIRECT_URI
    }).toString();
    
    const url = new URL(TOKEN_URL);
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postData),
        "Authorization": `Basic ${basicAuth}`
      }
    };
    
    const req = https.request(options, (res) => {
      let data = "";
      
      res.on("data", (chunk) => {
        data += chunk;
      });
      
      res.on("end", () => {
        try {
          if (!data || data.trim() === "") {
            reject(new Error(`Empty response from server (HTTP ${res.statusCode})`));
            return;
          }
          
          const response = JSON.parse(data);
          
          if (res.statusCode !== 200) {
            reject(new Error(`Token exchange failed (HTTP ${res.statusCode}): ${response.error_description || response.error || data}`));
            return;
          }
          
          resolve(response);
        } catch (err) {
          reject(new Error(`Failed to parse token response: ${err.message}`));
        }
      });
    });
    
    req.on("error", (err) => {
      reject(new Error(`Network error: ${err.message}`));
    });
    
    req.write(postData);
    req.end();
  });
}

// ============================================================================
// Device/Room Selection Functions
// ============================================================================

/**
 * Prompt for MagicMirror position
 */
async function promptForPosition() {
  console.log("Step 2: Module Position");
  console.log("════════════════════════════════════════════════════════════════");
  console.log("");
  console.log("Available positions:");
  
  VALID_POSITIONS.forEach((pos, i) => {
    console.log(`  ${(i + 1).toString().padStart(2)}. ${pos}`);
  });
  
  console.log("");
  const choice = await prompt("Enter position number or name (default: top_right): ");
  
  if (!choice.trim()) {
    console.log("   Using default: top_right");
    return "top_right";
  }
  
  // Check if it's a number
  const num = parseInt(choice);
  if (num >= 1 && num <= VALID_POSITIONS.length) {
    return VALID_POSITIONS[num - 1];
  }
  
  // Check if it's a valid position name
  if (VALID_POSITIONS.includes(choice.trim())) {
    return choice.trim();
  }
  
  console.log("⚠️  Invalid position, using 'top_right' as default");
  return "top_right";
}

/**
 * Select SmartThings location
 */
async function selectLocation() {
  console.log("");
  console.log("Step 3: Select Location");
  console.log("════════════════════════════════════════════════════════════════");
  
  const response = await apiRequest("/locations");
  const locations = response.items || [];
  
  if (locations.length === 0) {
    throw new Error("No SmartThings locations found");
  }
  
  if (locations.length === 1) {
    console.log(`\n📍 Using location: ${locations[0].name}`);
    return locations[0];
  }
  
  console.log("\nAvailable locations:");
  locations.forEach((loc, i) => {
    console.log(`  ${i + 1}. ${loc.name}`);
  });
  
  const choice = await prompt("\nSelect location number: ");
  const index = parseInt(choice) - 1;
  
  if (index >= 0 && index < locations.length) {
    return locations[index];
  }
  
  console.log("⚠️  Invalid selection, using first location");
  return locations[0];
}

/**
 * Select rooms from location
 */
async function selectRooms(locationId) {
  console.log("");
  console.log("Step 4: Select Rooms");
  console.log("════════════════════════════════════════════════════════════════");
  
  const response = await apiRequest(`/locations/${locationId}/rooms`);
  const rooms = response.items || [];
  
  if (rooms.length === 0) {
    console.log("\nNo rooms found in this location.");
    return [];
  }
  
  console.log("\nAvailable rooms (enter numbers separated by commas, or 'all'):");
  rooms.forEach((room, i) => {
    console.log(`  ${(i + 1).toString().padStart(2)}. ${room.name}`);
  });
  
  const choice = await prompt("\nSelect rooms: ");
  
  if (choice.toLowerCase().trim() === "all") {
    console.log(`✅ Selected all ${rooms.length} rooms`);
    return rooms.map(r => ({ roomId: r.roomId, name: r.name }));
  }
  
  const indices = choice.split(",").map(s => parseInt(s.trim()) - 1);
  const selectedRooms = [];
  
  for (const index of indices) {
    if (index >= 0 && index < rooms.length) {
      selectedRooms.push({ roomId: rooms[index].roomId, name: rooms[index].name });
    }
  }
  
  if (selectedRooms.length === 0) {
    console.log("⚠️  No valid rooms selected");
  } else {
    console.log(`✅ Selected ${selectedRooms.length} room(s)`);
  }
  
  return selectedRooms;
}

/**
 * Select devices from rooms
 */
async function selectDevices(locationId, rooms) {
  console.log("");
  console.log("Step 5: Select Devices");
  console.log("════════════════════════════════════════════════════════════════");
  
  if (rooms.length === 0) {
    console.log("\nNo rooms selected, skipping device selection.");
    return [];
  }
  
  // Gather all devices from selected rooms
  const allDevices = [];
  
  for (const room of rooms) {
    process.stdout.write(`\n📁 Fetching devices from ${room.name}...`);
    const response = await apiRequest(`/locations/${locationId}/rooms/${room.roomId}/devices`);
    const devices = response.items || [];
    
    for (const device of devices) {
      // Get device details for capabilities
      const details = await apiRequest(`/devices/${device.deviceId}`);
      const capabilities = extractCapabilities(details);
      
      allDevices.push({
        id: device.deviceId,
        name: device.label || device.name,
        room: room.name,
        capabilities: capabilities
      });
    }
    console.log(` ${devices.length} devices`);
  }
  
  if (allDevices.length === 0) {
    console.log("\nNo devices found in selected rooms.");
    return [];
  }
  
  console.log("\n" + "─".repeat(60));
  console.log("Available devices (enter numbers separated by commas, 'all', or 'none'):");
  console.log("─".repeat(60));
  
  allDevices.forEach((device, i) => {
    const caps = device.capabilities.slice(0, 3).join(", ");
    console.log(`  ${(i + 1).toString().padStart(2)}. [${device.room}] ${device.name}`);
    if (caps) {
      console.log(`      └─ ${caps}`);
    }
  });
  
  console.log("");
  const choice = await prompt("Select devices: ");
  
  if (choice.toLowerCase().trim() === "none") {
    console.log("   No devices selected (will use room-based selection)");
    return [];
  }
  
  if (choice.toLowerCase().trim() === "all") {
    console.log(`✅ Selected all ${allDevices.length} devices`);
    return allDevices.map(d => ({ id: d.id, name: d.name, room: d.room }));
  }
  
  const indices = choice.split(",").map(s => parseInt(s.trim()) - 1);
  const selectedDevices = [];
  
  for (const index of indices) {
    if (index >= 0 && index < allDevices.length) {
      const d = allDevices[index];
      selectedDevices.push({ id: d.id, name: d.name, room: d.room });
    }
  }
  
  console.log(`✅ Selected ${selectedDevices.length} device(s)`);
  return selectedDevices;
}

/**
 * Prompt for additional options
 */
async function promptForOptions() {
  console.log("");
  console.log("Step 6: Display Options");
  console.log("════════════════════════════════════════════════════════════════");
  console.log("");
  
  const pollInterval = await prompt("Poll interval in seconds (default: 60): ");
  const showLastUpdated = await prompt("Show last updated time? (Y/n): ");
  const tempUnit = await prompt("Temperature unit - F or C (default: F): ");
  const sortBy = await prompt("Sort by - name/room/capability (default: name): ");
  const debug = await prompt("Enable debug logging? (y/N): ");
  
  return {
    pollInterval: parseInt(pollInterval) * 1000 || 60000,
    showLastUpdated: showLastUpdated.toLowerCase() !== "n",
    temperatureUnit: tempUnit.toUpperCase() === "C" ? "C" : "F",
    defaultSort: ["name", "room", "capability"].includes(sortBy.toLowerCase()) ? sortBy.toLowerCase() : "name",
    debug: debug.toLowerCase() === "y"
  };
}

// ============================================================================
// Config Generation Functions
// ============================================================================

/**
 * Generate config object (no secrets - they're stored encrypted separately)
 */
function generateConfig(position, rooms, devices, options) {
  const config = {
    module: "MMM-STStatus",
    position: position,
    header: "Smart Home",
    config: {
      pollInterval: options.pollInterval,
      showLastUpdated: options.showLastUpdated,
      temperatureUnit: options.temperatureUnit,
      defaultSort: options.defaultSort,
      debug: options.debug,
      testMode: false
    }
  };
  
  // If explicit devices are selected, use those
  // If no explicit devices, include rooms to fetch all devices from those rooms
  if (devices.length > 0) {
    config.config.devices = devices.map(d => ({ id: d.id, name: d.name }));
  } else if (rooms.length > 0) {
    config.config.rooms = rooms.map(r => r.name);
  }
  
  return config;
}

/**
 * Output the config block
 */
function outputConfig(config) {
  console.log("");
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║                    ✅ Setup Complete!                          ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log("");
  console.log("Add this to your ~/MagicMirror/config/config.js modules array:");
  console.log("");
  console.log("─".repeat(65));
  console.log(formatConfig(config));
  console.log("─".repeat(65));
  console.log("");
  console.log("📝 Notes:");
  console.log("   • This script does NOT modify config.js automatically");
  console.log("   • Copy the above configuration and paste it manually");
  console.log("   • OAuth credentials are stored encrypted in oauth-data.enc (not in config.js)");
  console.log("   • Tokens auto-refresh every 20 hours");
  console.log("   • Restart MagicMirror after updating config.js");
  console.log("");
}

/**
 * Format config object as JavaScript
 */
function formatConfig(obj, indent = 0) {
  const spaces = "  ".repeat(indent);
  const lines = [];
  
  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    lines.push("[");
    obj.forEach((item, i) => {
      const comma = i < obj.length - 1 ? "," : "";
      if (typeof item === "object") {
        lines.push(spaces + "  " + formatConfig(item, indent + 1) + comma);
      } else if (typeof item === "string") {
        lines.push(spaces + '  "' + item + '"' + comma);
      } else {
        lines.push(spaces + "  " + item + comma);
      }
    });
    lines.push(spaces + "]");
    return lines.join("\n");
  }
  
  if (typeof obj === "object" && obj !== null) {
    lines.push("{");
    const keys = Object.keys(obj);
    keys.forEach((key, i) => {
      const comma = i < keys.length - 1 ? "," : "";
      const value = obj[key];
      
      if (typeof value === "string") {
        lines.push(spaces + `  ${key}: "${value}"${comma}`);
      } else if (typeof value === "boolean" || typeof value === "number") {
        lines.push(spaces + `  ${key}: ${value}${comma}`);
      } else if (Array.isArray(value)) {
        lines.push(spaces + `  ${key}: ${formatConfig(value, indent + 1)}${comma}`);
      } else if (typeof value === "object") {
        lines.push(spaces + `  ${key}: ${formatConfig(value, indent + 1)}${comma}`);
      }
    });
    lines.push(spaces + "}");
    return lines.join("\n");
  }
  
  return String(obj);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create readline interface
 */
function createReadline() {
  const interface = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  // Handle close event once (Ctrl+D or stream end)
  interface.on("close", () => {
    console.log("\n\n✅ Setup was successful.");
    process.exit(0);
  });
  
  return interface;
}

/**
 * Promisified question - handles readline without adding multiple close listeners
 */
function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

/**
 * Validate UUID format
 */
function isValidUUID(str) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Extract capability names from device details
 */
function extractCapabilities(details) {
  const caps = [];
  if (details && details.components) {
    for (const component of details.components) {
      if (component.capabilities) {
        for (const cap of component.capabilities) {
          if (!caps.includes(cap.id)) {
            caps.push(cap.id);
          }
        }
      }
    }
  }
  return caps;
}

/**
 * Make SmartThings API request
 */
async function apiRequest(endpoint) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + endpoint);
    
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: "GET",
      headers: {
        "Authorization": "Bearer " + accessToken,
        "Content-Type": "application/json"
      }
    };
    
    const req = https.request(options, (res) => {
      let data = "";
      
      res.on("data", (chunk) => {
        data += chunk;
      });
      
      res.on("end", () => {
        try {
          if (res.statusCode === 401 || res.statusCode === 403) {
            reject(new Error("Authentication failed"));
            return;
          }
          
          if (res.statusCode !== 200) {
            reject(new Error(`API error: ${res.statusCode}`));
            return;
          }
          
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error(`Failed to parse response: ${err.message}`));
        }
      });
    });
    
    req.on("error", (err) => {
      reject(new Error(`Network error: ${err.message}`));
    });
    
    req.end();
  });
}

// Handle Ctrl+C gracefully
process.on("SIGINT", () => {
  console.log("\n\n👋 Setup cancelled. No changes were made.");
  process.exit(0);
});

// Run
main();
