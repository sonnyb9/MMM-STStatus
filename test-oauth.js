#!/usr/bin/env node

/**
 * test-oauth.js - Test OAuth credentials without full setup
 * 
 * This script verifies your OAuth app configuration by testing the token exchange.
 * Run this first to diagnose issues before running full setup.
 */

const https = require("https");
const readline = require("readline");
const { URLSearchParams } = require("url");

const TOKEN_URL = "https://api.smartthings.com/oauth/token";
const AUTH_URL = "https://api.smartthings.com/oauth/authorize";
const REDIRECT_URI = "https://httpbin.org/get";
const SCOPES = "r:devices:* x:devices:* r:locations:*";

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function testTokenExchange(clientId, clientSecret, code) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      grant_type: "authorization_code",
      code: code,
      client_id: clientId,
      redirect_uri: REDIRECT_URI
    }).toString();
    
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    
    console.log("\n🔍 Debug Info:");
    console.log(`  Client ID: ${clientId.substring(0, 8)}...`);
    console.log(`  Redirect URI: ${REDIRECT_URI}`);
    console.log(`  Auth header: Basic ${basicAuth.substring(0, 20)}...`);
    console.log(`  Code: ${code.substring(0, 10)}...`);
    console.log("");
    
    const options = {
      hostname: "api.smartthings.com",
      port: 443,
      path: "/oauth/token",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postData),
        "Authorization": `Basic ${basicAuth}`,
        "Accept": "application/json"
      }
    };
    
    const req = https.request(options, (res) => {
      let data = "";
      
      console.log(`📡 Response Status: ${res.statusCode}`);
      console.log(`📡 Response Headers:`, res.headers);
      console.log("");
      
      res.on("data", (chunk) => {
        data += chunk;
      });
      
      res.on("end", () => {
        console.log(`📦 Response Body: ${data || "(empty)"}`);
        console.log("");
        
        if (res.statusCode === 200) {
          try {
            const tokens = JSON.parse(data);
            resolve({ success: true, tokens });
          } catch (err) {
            reject(new Error(`Parse error: ${err.message}`));
          }
        } else {
          resolve({ 
            success: false, 
            status: res.statusCode, 
            body: data,
            headers: res.headers 
          });
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

async function main() {
  console.log("\n╔════════════════════════════════════════════════════════╗");
  console.log("║       MMM-STStatus OAuth Diagnostics                  ║");
  console.log("╚════════════════════════════════════════════════════════╝\n");
  
  console.log("This script tests your OAuth credentials before running setup.");
  console.log("");
  
  // Get credentials
  const clientId = await prompt("Enter Client ID: ");
  const clientSecret = await prompt("Enter Client Secret: ");
  
  if (!clientId || !clientSecret) {
    console.error("\n❌ Client ID and Secret are required\n");
    process.exit(1);
  }
  
  // Generate auth URL
  const state = Math.random().toString(36).substring(2);
  const authParams = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    state: state
  });
  const authUrl = `${AUTH_URL}?${authParams.toString()}`;
  
  console.log("\n────────────────────────────────────────────────────────");
  console.log("Step 1: Authorize");
  console.log("────────────────────────────────────────────────────────\n");
  console.log("Open this URL in your browser:\n");
  console.log(authUrl);
  console.log("\nAfter authorizing, copy the FULL redirect URL.");
  console.log("");
  
  const redirectUrl = await prompt("Paste redirect URL: ");
  
  // Extract code
  let code;
  try {
    const url = new URL(redirectUrl);
    code = url.searchParams.get("code");
    if (!code) {
      throw new Error("No code found");
    }
  } catch (err) {
    console.error(`\n❌ Invalid redirect URL: ${err.message}\n`);
    process.exit(1);
  }
  
  console.log("\n────────────────────────────────────────────────────────");
  console.log("Step 2: Test Token Exchange");
  console.log("────────────────────────────────────────────────────────\n");
  
  try {
    const result = await testTokenExchange(clientId, clientSecret, code);
    
    if (result.success) {
      console.log("✅ SUCCESS! OAuth credentials are valid.");
      console.log("\nTokens received:");
      console.log(`  Access Token: ${result.tokens.access_token.substring(0, 20)}...`);
      console.log(`  Refresh Token: ${result.tokens.refresh_token.substring(0, 20)}...`);
      console.log(`  Expires In: ${result.tokens.expires_in} seconds`);
      console.log("\n✅ You can now run: node setup.js");
      console.log("");
    } else {
      console.log("❌ FAILED! Token exchange returned error.\n");
      console.log(`Status: ${result.status}`);
      console.log(`Body: ${result.body || "(empty)"}`);
      console.log("");
      console.log("Common causes:");
      console.log("  • Client ID/Secret don't match the SmartThings app");
      console.log("  • Authorization code expired (must complete quickly)");
      console.log("  • Redirect URI mismatch (must be: https://httpbin.org/get)");
      console.log("  • OAuth app not properly configured in SmartThings");
      console.log("");
      
      if (result.status === 401 && !result.body) {
        console.log("⚠️  Empty 401 response suggests incorrect Client ID/Secret");
        console.log("    or redirect URI mismatch in SmartThings app config.");
      }
    }
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}\n`);
  }
}

main().catch(err => {
  console.error(`\nFatal error: ${err.message}\n`);
  process.exit(1);
});
