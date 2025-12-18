/* oauth-utils.js
 * Encryption/decryption utilities for OAuth token storage
 * Uses AES-256-GCM for authenticated encryption
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Encryption settings
const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;  // 128 bits
const AUTH_TAG_LENGTH = 16;
const SALT = "MMM-STStatus-OAuth-v1"; // Static salt for key derivation

/**
 * Derive encryption key from Client ID and Client Secret
 * Uses PBKDF2 with SHA-512
 */
function deriveKey(clientId, clientSecret) {
  const combined = clientId + ":" + clientSecret;
  return crypto.pbkdf2Sync(combined, SALT, 100000, KEY_LENGTH, "sha512");
}

/**
 * Encrypt token data
 * @param {Object} tokenData - Token object to encrypt
 * @param {string} clientId - OAuth Client ID
 * @param {string} clientSecret - OAuth Client Secret
 * @returns {string} Base64-encoded encrypted data
 */
function encryptTokens(tokenData, clientId, clientSecret) {
  const key = deriveKey(clientId, clientSecret);
  const iv = crypto.randomBytes(IV_LENGTH);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  const jsonData = JSON.stringify(tokenData);
  let encrypted = cipher.update(jsonData, "utf8", "base64");
  encrypted += cipher.final("base64");
  
  const authTag = cipher.getAuthTag();
  
  // Combine IV + AuthTag + Encrypted data
  const combined = Buffer.concat([
    iv,
    authTag,
    Buffer.from(encrypted, "base64")
  ]);
  
  return combined.toString("base64");
}

/**
 * Decrypt token data
 * @param {string} encryptedData - Base64-encoded encrypted data
 * @param {string} clientId - OAuth Client ID
 * @param {string} clientSecret - OAuth Client Secret
 * @returns {Object|null} Decrypted token object, or null on failure
 */
function decryptTokens(encryptedData, clientId, clientSecret) {
  try {
    const key = deriveKey(clientId, clientSecret);
    const combined = Buffer.from(encryptedData, "base64");
    
    // Extract IV, AuthTag, and encrypted data
    const iv = combined.slice(0, IV_LENGTH);
    const authTag = combined.slice(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = combined.slice(IV_LENGTH + AUTH_TAG_LENGTH);
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, null, "utf8");
    decrypted += decipher.final("utf8");
    
    return JSON.parse(decrypted);
  } catch (err) {
    console.error("[OAuth] Decryption failed:", err.message);
    return null;
  }
}

/**
 * Save encrypted tokens to file
 * @param {string} filePath - Path to token file
 * @param {Object} tokenData - Token object to save
 * @param {string} clientId - OAuth Client ID
 * @param {string} clientSecret - OAuth Client Secret
 */
function saveTokens(filePath, tokenData, clientId, clientSecret) {
  const encrypted = encryptTokens(tokenData, clientId, clientSecret);
  
  const fileData = {
    version: 1,
    encrypted: encrypted,
    created: new Date().toISOString()
  };
  
  fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2));
}

/**
 * Load and decrypt tokens from file
 * @param {string} filePath - Path to token file
 * @param {string} clientId - OAuth Client ID
 * @param {string} clientSecret - OAuth Client Secret
 * @returns {Object|null} Token object, or null if file doesn't exist or decryption fails
 */
function loadTokens(filePath, clientId, clientSecret) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    const fileData = JSON.parse(fs.readFileSync(filePath, "utf8"));
    
    if (fileData.version !== 1) {
      console.error("[OAuth] Unsupported token file version");
      return null;
    }
    
    return decryptTokens(fileData.encrypted, clientId, clientSecret);
  } catch (err) {
    console.error("[OAuth] Error loading tokens:", err.message);
    return null;
  }
}

/**
 * Check if tokens are expired or expiring soon
 * @param {Object} tokenData - Token object with expiresAt field
 * @param {number} bufferSeconds - Refresh this many seconds before expiration (default: 300 = 5 minutes)
 * @returns {boolean} True if tokens need refresh
 */
function tokensNeedRefresh(tokenData, bufferSeconds = 300) {
  if (!tokenData || !tokenData.expiresAt) {
    return true;
  }
  
  const expiresAt = new Date(tokenData.expiresAt).getTime();
  const now = Date.now();
  const bufferMs = bufferSeconds * 1000;
  
  return now >= (expiresAt - bufferMs);
}

/**
 * Get default token file path
 * @param {string} moduleDir - Module directory path
 * @returns {string} Full path to token file
 */
function getTokenFilePath(moduleDir) {
  return path.join(moduleDir, "oauth-tokens.enc");
}

module.exports = {
  encryptTokens,
  decryptTokens,
  saveTokens,
  loadTokens,
  tokensNeedRefresh,
  getTokenFilePath
};
