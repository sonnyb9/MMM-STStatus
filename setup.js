#!/usr/bin/env node

/**
 * setup.js - Interactive setup script for MMM-STStatus
 * 
 * Helps users configure the module by:
 * - Validating their SmartThings PAT
 * - Selecting locations and rooms
 * - Selecting specific devices
 * - Generating a ready-to-paste config block
 * 
 * Usage: node setup.js [--dry-run]
 */

const readline = require("readline");
const fetch = require("node-fetch");

// API configuration
const API_BASE = "https://api.smartthings.com/v1";

// Valid MagicMirror positions
const VALID_POSITIONS = [
  "top_bar", "top_left", "top_center", "top_right",
  "upper_third", "middle_center", "lower_third",
  "bottom_left", "bottom_center", "bottom_right", "bottom_bar",
  "fullscreen_above", "fullscreen_below"
];

// State
let token = null;
let dryRun = process.argv.includes("--dry-run");

// Readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * Main entry point
 */
async function main() {
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║           MMM-STStatus Configuration Setup                 ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  if (dryRun) {
    console.log("📋 DRY RUN MODE - No files will be modified\n");
  }

  try {
    // Step 1: Get and validate PAT
    token = await promptForToken();
    
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
    const config = generateConfig(token, position, rooms, devices, options);
    
    // Step 8: Output config
    outputConfig(config);
    
  } catch (err) {
    if (err.message === "USER_CANCELLED") {
      console.log("\n👋 Setup cancelled. No changes were made.");
    } else {
      console.error("\n❌ Error:", err.message);
    }
  }

  rl.close();
}

/**
 * Prompt for SmartThings Personal Access Token
 */
async function promptForToken() {
  console.log("Step 1: SmartThings Personal Access Token");
  console.log("─────────────────────────────────────────");
  console.log("Get your token at: https://account.smartthings.com/tokens\n");

  const pat = await question("Enter your PAT: ");
  
  // Validate format (UUID)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(pat.trim())) {
    throw new Error("Invalid PAT format. Should be a UUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)");
  }

  // Test the token
  console.log("\n🔐 Validating token...");
  try {
    const response = await apiRequest("/locations", pat.trim());
    if (response && response.items) {
      console.log("✅ Token validated successfully!\n");
      return pat.trim();
    }
  } catch (err) {
    throw new Error("Token validation failed. Please check your PAT and try again.");
  }
}

/**
 * Prompt for MagicMirror position
 */
async function promptForPosition() {
  console.log("\nStep 2: Module Position");
  console.log("───────────────────────");
  console.log("Available positions:");
  
  VALID_POSITIONS.forEach((pos, i) => {
    console.log(`  ${(i + 1).toString().padStart(2)}. ${pos}`);
  });
  
  const choice = await question("\nEnter position number or name: ");
  
  // Check if it's a number
  const num = parseInt(choice);
  if (num >= 1 && num <= VALID_POSITIONS.length) {
    return VALID_POSITIONS[num - 1];
  }
  
  // Check if it's a valid position name
  if (VALID_POSITIONS.includes(choice.trim())) {
    return choice.trim();
  }
  
  console.log("⚠️  Invalid position, using 'top_left' as default");
  return "top_left";
}

/**
 * Select SmartThings location
 */
async function selectLocation() {
  console.log("\nStep 3: Select Location");
  console.log("───────────────────────");
  
  const response = await apiRequest("/locations", token);
  const locations = response.items || [];
  
  if (locations.length === 0) {
    throw new Error("No SmartThings locations found");
  }
  
  if (locations.length === 1) {
    console.log(`📍 Using location: ${locations[0].name}`);
    return locations[0];
  }
  
  console.log("Available locations:");
  locations.forEach((loc, i) => {
    console.log(`  ${i + 1}. ${loc.name}`);
  });
  
  const choice = await question("\nSelect location number: ");
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
  console.log("\nStep 4: Select Rooms");
  console.log("────────────────────");
  
  const response = await apiRequest(`/locations/${locationId}/rooms`, token);
  const rooms = response.items || [];
  
  if (rooms.length === 0) {
    console.log("No rooms found in this location.");
    return [];
  }
  
  console.log("Available rooms (enter numbers separated by commas, or 'all'):");
  rooms.forEach((room, i) => {
    console.log(`  ${i + 1}. ${room.name}`);
  });
  
  const choice = await question("\nSelect rooms: ");
  
  if (choice.toLowerCase().trim() === "all") {
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
  console.log("\nStep 5: Select Devices");
  console.log("──────────────────────");
  
  if (rooms.length === 0) {
    console.log("No rooms selected, skipping device selection.");
    return [];
  }
  
  // Gather all devices from selected rooms
  const allDevices = [];
  
  for (const room of rooms) {
    console.log(`\n📁 Fetching devices from ${room.name}...`);
    const response = await apiRequest(`/locations/${locationId}/rooms/${room.roomId}/devices`, token);
    const devices = response.items || [];
    
    for (const device of devices) {
      // Get device details for capabilities
      const details = await apiRequest(`/devices/${device.deviceId}`, token);
      const capabilities = extractCapabilities(details);
      
      allDevices.push({
        id: device.deviceId,
        name: device.label || device.name,
        room: room.name,
        capabilities: capabilities
      });
    }
  }
  
  if (allDevices.length === 0) {
    console.log("No devices found in selected rooms.");
    return [];
  }
  
  console.log("\nAvailable devices (enter numbers separated by commas, 'all', or 'none'):");
  allDevices.forEach((device, i) => {
    const caps = device.capabilities.slice(0, 3).join(", ");
    console.log(`  ${(i + 1).toString().padStart(2)}. [${device.room}] ${device.name}`);
    console.log(`      Capabilities: ${caps || "unknown"}`);
  });
  
  const choice = await question("\nSelect devices: ");
  
  if (choice.toLowerCase().trim() === "none") {
    return [];
  }
  
  if (choice.toLowerCase().trim() === "all") {
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
  console.log("\nStep 6: Additional Options");
  console.log("──────────────────────────");
  
  const pollInterval = await question("Poll interval in seconds (default: 60): ");
  const showLastUpdated = await question("Show last updated time? (Y/n): ");
  const tempUnit = await question("Temperature unit (F/C, default: F): ");
  const sortBy = await question("Sort by (name/room/capability, default: name): ");
  
  return {
    pollInterval: parseInt(pollInterval) * 1000 || 60000,
    showLastUpdated: showLastUpdated.toLowerCase() !== "n",
    temperatureUnit: tempUnit.toUpperCase() === "C" ? "C" : "F",
    defaultSort: ["name", "room", "capability"].includes(sortBy.toLowerCase()) ? sortBy.toLowerCase() : "name"
  };
}

/**
 * Generate config object
 */
function generateConfig(token, position, rooms, devices, options) {
  const config = {
    module: "MMM-STStatus",
    position: position,
    header: "Smart Home",
    config: {
      token: token,
      pollInterval: options.pollInterval,
      showLastUpdated: options.showLastUpdated,
      temperatureUnit: options.temperatureUnit,
      defaultSort: options.defaultSort,
      debug: false,
      testMode: false
    }
  };
  
  // If explicit devices are selected, use ONLY those (don't include rooms)
  // If no explicit devices, include rooms to fetch all devices from those rooms
  if (devices.length > 0) {
    config.config.devices = devices.map(d => ({ id: d.id, name: d.name }));
    // Note: rooms are intentionally NOT included when explicit devices are selected
  } else if (rooms.length > 0) {
    config.config.rooms = rooms.map(r => r.name);
  }
  
  return config;
}

/**
 * Output the config block
 */
function outputConfig(config) {
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║                   Configuration Block                      ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log("\nAdd this to your config.js modules array:\n");
  console.log("─".repeat(60));
  console.log(formatConfig(config));
  console.log("─".repeat(60));
  console.log("\n✅ Setup complete!");
  console.log("\n📝 Note: This script does NOT modify config.js automatically.");
  console.log("   Copy the above configuration and paste it manually.\n");
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
 * Make API request
 */
async function apiRequest(endpoint, accessToken) {
  const response = await fetch(API_BASE + endpoint, {
    headers: {
      "Authorization": "Bearer " + accessToken,
      "Content-Type": "application/json"
    }
  });
  
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Authentication failed");
    }
    throw new Error(`API error: ${response.status}`);
  }
  
  return await response.json();
}

/**
 * Promisified question
 */
function question(prompt) {
  return new Promise((resolve, reject) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
    
    rl.on("close", () => {
      reject(new Error("USER_CANCELLED"));
    });
  });
}

// Handle Ctrl+C gracefully
process.on("SIGINT", () => {
  console.log("\n\n👋 Setup cancelled. No changes were made.");
  process.exit(0);
});

// Run
main();
