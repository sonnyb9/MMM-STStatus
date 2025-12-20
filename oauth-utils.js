/* oauth-utils.js
 * Encryption/decryption utilities for OAuth credentials and token storage
 * Uses AES-256-GCM for authenticated encryption with a local key file
 * 
 * Files:
 *   oauth-key.bin  - 32-byte random encryption key (chmod 600, gitignored)
 *   oauth-data.enc - Encrypted JSON containing clientId, clientSecret, tokens
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Encryption settings
const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;  // 128 bits
const AUTH_TAG_LENGTH = 16;

// File names
const KEY_FILE = "oauth-key.bin";
const DATA_FILE = "oauth-data.enc";

/**
 * Get path to key file
 * @param {string} moduleDir - Module directory path
 * @returns {string} Full path to key file
 */
function getKeyFilePath(moduleDir) {
  return path.join(moduleDir, KEY_FILE);
}

/**
 * Get path to encrypted data file
 * @param {string} moduleDir - Module directory path
 * @returns {string} Full path to data file
 */
function getDataFilePath(moduleDir) {
  return path.join(moduleDir, DATA_FILE);
}

/**
 * Generate a new random encryption key
 * @returns {Buffer} 32-byte random key
 */
function generateKey() {
  return crypto.randomBytes(KEY_LENGTH);
}

/**
 * Load encryption key from file, or generate if missing
 * @param {string} moduleDir - Module directory path
 * @param {boolean} createIfMissing - Create key file if it doesn't exist
 * @returns {Buffer|null} Encryption key, or null if file missing and createIfMissing is false
 */
function loadKey(moduleDir, createIfMissing = false) {
  const keyPath = getKeyFilePath(moduleDir);
  
  try {
    if (fs.existsSync(keyPath)) {
      const key = fs.readFileSync(keyPath);
      if (key.length !== KEY_LENGTH) {
        console.error("[OAuth] Invalid key file length");
        return null;
      }
      return key;
    }
    
    if (createIfMissing) {
      const key = generateKey();
      fs.writeFileSync(keyPath, key, { mode: 0o600 });
      console.log("[OAuth] Generated new encryption key");
      return key;
    }
    
    return null;
  } catch (err) {
    console.error("[OAuth] Error with key file:", err.message);
    return null;
  }
}

/**
 * Encrypt data using the key
 * @param {Object} data - Data object to encrypt
 * @param {Buffer} key - Encryption key
 * @returns {string} Base64-encoded encrypted data
 */
function encryptData(data, key) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  const jsonData = JSON.stringify(data);
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
 * Decrypt data using the key
 * @param {string} encryptedData - Base64-encoded encrypted data
 * @param {Buffer} key - Encryption key
 * @returns {Object|null} Decrypted data object, or null on failure
 */
function decryptData(encryptedData, key) {
  try {
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
 * Save OAuth data (credentials + tokens) to encrypted file
 * @param {string} moduleDir - Module directory path
 * @param {Object} data - Data object containing clientId, clientSecret, tokens, etc.
 * @returns {boolean} True on success
 */
function saveOAuthData(moduleDir, data) {
  try {
    const key = loadKey(moduleDir, true);
    if (!key) {
      console.error("[OAuth] Failed to load/create encryption key");
      return false;
    }
    
    const encrypted = encryptData(data, key);
    
    const fileData = {
      version: 2,
      encrypted: encrypted,
      updated: new Date().toISOString()
    };
    
    const dataPath = getDataFilePath(moduleDir);
    fs.writeFileSync(dataPath, JSON.stringify(fileData, null, 2), { mode: 0o600 });
    return true;
  } catch (err) {
    console.error("[OAuth] Error saving data:", err.message);
    return false;
  }
}

/**
 * Load OAuth data (credentials + tokens) from encrypted file
 * @param {string} moduleDir - Module directory path
 * @returns {Object|null} Data object, or null if not found or decryption fails
 */
function loadOAuthData(moduleDir) {
  try {
    const dataPath = getDataFilePath(moduleDir);
    const keyPath = getKeyFilePath(moduleDir);
    
    if (!fs.existsSync(dataPath)) {
      return null;
    }
    
    if (!fs.existsSync(keyPath)) {
      console.error("[OAuth] Data file exists but key file missing");
      return null;
    }
    
    const key = loadKey(moduleDir);
    if (!key) {
      return null;
    }
    
    const fileData = JSON.parse(fs.readFileSync(dataPath, "utf8"));
    
    if (fileData.version !== 2) {
      console.error("[OAuth] Unsupported data file version:", fileData.version);
      return null;
    }
    
    return decryptData(fileData.encrypted, key);
  } catch (err) {
    console.error("[OAuth] Error loading data:", err.message);
    return null;
  }
}

/**
 * Check if tokens are expired or expiring soon
 * @param {Object} oauthData - OAuth data object with expiresAt field
 * @param {number} bufferSeconds - Refresh this many seconds before expiration (default: 300 = 5 minutes)
 * @returns {boolean} True if tokens need refresh
 */
function tokensNeedRefresh(oauthData, bufferSeconds = 300) {
  if (!oauthData || !oauthData.expiresAt) {
    return true;
  }
  
  const expiresAt = new Date(oauthData.expiresAt).getTime();
  const now = Date.now();
  const bufferMs = bufferSeconds * 1000;
  
  return now >= (expiresAt - bufferMs);
}

/**
 * Check if OAuth data file exists
 * @param {string} moduleDir - Module directory path
 * @returns {boolean} True if data file exists
 */
function oauthDataExists(moduleDir) {
  const dataPath = getDataFilePath(moduleDir);
  return fs.existsSync(dataPath);
}

// =============================================================================
// Legacy compatibility - for transition period
// These functions maintain backward compatibility with old oauth-tokens.enc format
// =============================================================================

/**
 * Get default token file path (legacy)
 * @param {string} moduleDir - Module directory path
 * @returns {string} Full path to token file
 * @deprecated Use getDataFilePath instead
 */
function getTokenFilePath(moduleDir) {
  return path.join(moduleDir, "oauth-tokens.enc");
}

/**
 * Derive encryption key from Client ID and Client Secret (legacy)
 * @deprecated Key file is now used instead
 */
function deriveKey(clientId, clientSecret) {
  const SALT = "MMM-STStatus-OAuth-v1";
  const combined = clientId + ":" + clientSecret;
  return crypto.pbkdf2Sync(combined, SALT, 100000, KEY_LENGTH, "sha512");
}

/**
 * Load and decrypt tokens from legacy file format
 * @param {string} filePath - Path to token file
 * @param {string} clientId - OAuth Client ID
 * @param {string} clientSecret - OAuth Client Secret
 * @returns {Object|null} Token object, or null if file doesn't exist or decryption fails
 * @deprecated Use loadOAuthData instead
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
    
    const key = deriveKey(clientId, clientSecret);
    return decryptData(fileData.encrypted, key);
  } catch (err) {
    console.error("[OAuth] Error loading legacy tokens:", err.message);
    return null;
  }
}

/**
 * Save encrypted tokens to legacy file format
 * @deprecated Use saveOAuthData instead
 */
function saveTokens(filePath, tokenData, clientId, clientSecret) {
  const key = deriveKey(clientId, clientSecret);
  const encrypted = encryptData(tokenData, key);
  
  const fileData = {
    version: 1,
    encrypted: encrypted,
    created: new Date().toISOString()
  };
  
  fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2));
}

module.exports = {
  // New API (v2)
  loadKey,
  generateKey,
  saveOAuthData,
  loadOAuthData,
  tokensNeedRefresh,
  oauthDataExists,
  getKeyFilePath,
  getDataFilePath,
  
  // Legacy API (v1) - for backward compatibility
  getTokenFilePath,
  loadTokens,
  saveTokens
};
