#!/usr/bin/env node
/* oauth-setup.js
 * One-time OAuth setup script for MMM-STStatus
 * 
 * This script guides you through the OAuth authorization process:
 * 1. Enter your Client ID and Client Secret (from SmartThings Developer Workspace)
 * 2. Visit the authorization URL in your browser
 * 3. Grant permission and copy the authorization code from the redirect URL
 * 4. Paste the code here to exchange it for access/refresh tokens
 * 5. Tokens are encrypted and saved for the module to use
 * 
 * Usage: node oauth-setup.js
 */

const readline = require("readline");
const https = require("https");
const { URL, URLSearchParams } = require("url");
const path = require("path");
const {
  saveTokens,
  loadTokens,
  getTokenFilePath
} = require("./oauth-utils");

// SmartThings OAuth endpoints
const AUTH_URL = "https://api.smartthings.com/oauth/authorize";
const TOKEN_URL = "https://api.smartthings.com/oauth/token";
const REDIRECT_URI = "https://httpbin.org/get";

// Scopes needed for device monitoring and control
const SCOPES = [
  "r:devices:*",      // Read device information
  "x:devices:*",      // Execute device commands
  "r:locations:*"     // Read location information
].join(" ");

// Module directory
const MODULE_DIR = __dirname;

/**
 * Create readline interface for user input
 */
function createReadline() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

/**
 * Prompt user for input
 */
function prompt(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

/**
 * Prompt for sensitive input (no echo - but Node.js doesn't support this easily)
 * We'll just warn the user
 */
function promptSensitive(rl, question) {
  return new Promise((resolve) => {
    // Note: Node.js readline doesn't hide input, so we warn the user
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
 * Generate the authorization URL
 */
function generateAuthUrl(clientId, state) {
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
    // Handle cases where user might paste just the code
    if (!redirectUrl.includes("://") && !redirectUrl.includes("?")) {
      // Assume it's just the code
      return { code: redirectUrl, state: null };
    }
    
    // Parse the full URL
    let url;
    try {
      url = new URL(redirectUrl);
    } catch {
      // Try adding https:// if missing
      url = new URL("https://" + redirectUrl);
    }
    
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
    throw new Error(`Failed to parse redirect URL: ${err.message}`);
  }
}

/**
 * Exchange authorization code for tokens
 */
function exchangeCodeForTokens(code, clientId, clientSecret) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      grant_type: "authorization_code",
      code: code,
      client_id: clientId,
      redirect_uri: REDIRECT_URI
    }).toString();
    
    const url = new URL(TOKEN_URL);
    
    // Create Basic Auth header
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

/**
 * Main setup flow
 */
async function main() {
  console.log("");
  console.log("╔═══════════════════════════════════════════════════════════════╗");
  console.log("║           MMM-STStatus OAuth Setup                            ║");
  console.log("╠═══════════════════════════════════════════════════════════════╣");
  console.log("║  This script will guide you through the OAuth authorization  ║");
  console.log("║  process to connect MMM-STStatus to your SmartThings account ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝");
  console.log("");
  
  const rl = createReadline();
  
  try {
    // Check for existing tokens
    const tokenFile = getTokenFilePath(MODULE_DIR);
    console.log(`Token file location: ${tokenFile}`);
    console.log("");
    
    // Step 1: Get Client ID
    console.log("Step 1: Enter your OAuth credentials");
    console.log("─".repeat(50));
    console.log("These were provided when you created your app in the");
    console.log("SmartThings Developer Workspace using the CLI.");
    console.log("");
    
    const clientId = await prompt(rl, "OAuth Client ID: ");
    
    if (!clientId) {
      console.error("\n❌ Client ID is required.");
      process.exit(1);
    }
    
    // Validate Client ID format (should be UUID)
    if (!isValidUUID(clientId)) {
      console.warn("\n⚠️  Warning: Client ID doesn't appear to be a valid UUID format.");
      const cont = await prompt(rl, "Continue anyway? (y/n): ");
      if (cont.toLowerCase() !== "y") {
        process.exit(1);
      }
    }
    
    // Step 2: Get Client Secret
    console.log("");
    console.log("Note: Your input will be visible. Make sure no one is watching.");
    const clientSecret = await promptSensitive(rl, "OAuth Client Secret: ");
    
    if (!clientSecret) {
      console.error("\n❌ Client Secret is required.");
      process.exit(1);
    }
    
    // Check for existing valid tokens
    const existingTokens = loadTokens(tokenFile, clientId, clientSecret);
    if (existingTokens && existingTokens.refresh_token) {
      console.log("");
      console.log("⚠️  Existing tokens found!");
      const overwrite = await prompt(rl, "Do you want to replace them? (y/n): ");
      if (overwrite.toLowerCase() !== "y") {
        console.log("\nSetup cancelled. Existing tokens will be used.");
        rl.close();
        return;
      }
    }
    
    // Step 3: Generate authorization URL
    console.log("");
    console.log("Step 2: Authorize with SmartThings");
    console.log("─".repeat(50));
    
    const state = Math.random().toString(36).substring(2, 15);
    const authUrl = generateAuthUrl(clientId, state);
    
    console.log("");
    console.log("Open this URL in your browser to authorize:");
    console.log("");
    console.log("┌" + "─".repeat(68) + "┐");
    console.log("│ " + authUrl.substring(0, 66) + (authUrl.length > 66 ? "…" : " ".repeat(66 - authUrl.length)) + " │");
    if (authUrl.length > 66) {
      // Print full URL on next lines
      console.log("└" + "─".repeat(68) + "┘");
      console.log("");
      console.log("Full URL (copy this):");
      console.log(authUrl);
    } else {
      console.log("└" + "─".repeat(68) + "┘");
    }
    console.log("");
    console.log("After authorizing, you'll be redirected to a page that won't load.");
    console.log("That's expected! Copy the ENTIRE URL from your browser's address bar.");
    console.log("");
    console.log("It will look something like:");
    console.log("https://localhost/callback?code=XXXXX&state=XXXXX");
    console.log("");
    
    // Step 4: Get the redirect URL with code
    const redirectUrl = await prompt(rl, "Paste the redirect URL here: ");
    
    if (!redirectUrl) {
      console.error("\n❌ Redirect URL is required.");
      process.exit(1);
    }
    
    // Extract code from URL
    const { code, state: returnedState } = extractCodeFromUrl(redirectUrl);
    
    // Verify state if present
    if (returnedState && returnedState !== state) {
      console.warn("\n⚠️  Warning: State mismatch. This could indicate a security issue.");
      const cont = await prompt(rl, "Continue anyway? (y/n): ");
      if (cont.toLowerCase() !== "y") {
        process.exit(1);
      }
    }
    
    console.log("");
    console.log("Exchanging authorization code for tokens...");
    
    // Step 5: Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code, clientId, clientSecret);
    
    // Add expiration timestamp
    const tokenData = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type || "Bearer",
      scope: tokens.scope || SCOPES,
      expiresAt: new Date(Date.now() + (tokens.expires_in || 86400) * 1000).toISOString(),
      obtainedAt: new Date().toISOString()
    };
    
    // Step 6: Save encrypted tokens
    console.log("Saving encrypted tokens...");
    saveTokens(tokenFile, tokenData, clientId, clientSecret);
    
    console.log("");
    console.log("╔═══════════════════════════════════════════════════════════════╗");
    console.log("║                    ✅ Setup Complete!                         ║");
    console.log("╚═══════════════════════════════════════════════════════════════╝");
    console.log("");
    console.log("Tokens have been encrypted and saved to:");
    console.log(`  ${tokenFile}`);
    console.log("");
    console.log("Now update your MagicMirror config.js to use OAuth:");
    console.log("");
    console.log("┌" + "─".repeat(60) + "┐");
    console.log("│ {                                                          │");
    console.log("│   module: \"MMM-STStatus\",                                  │");
    console.log("│   position: \"top_right\",                                   │");
    console.log("│   config: {                                                │");
    console.log("│     clientId: \"" + clientId.substring(0, 20) + "...\",          │");
    console.log("│     clientSecret: \"YOUR_CLIENT_SECRET\",                    │");
    console.log("│     // Remove the old 'token' field                        │");
    console.log("│     devices: [...],                                        │");
    console.log("│     // ... other config options                            │");
    console.log("│   }                                                        │");
    console.log("│ }                                                          │");
    console.log("└" + "─".repeat(60) + "┘");
    console.log("");
    console.log("The module will automatically refresh tokens before they expire.");
    console.log("");
    
  } catch (err) {
    console.error("");
    console.error("❌ Error:", err.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Handle Ctrl+C gracefully
process.on("SIGINT", () => {
  console.log("\n\nSetup cancelled.");
  process.exit(0);
});

// Run main
main();
