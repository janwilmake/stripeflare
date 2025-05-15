const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96 bits for AES-GCM

// Generate a cryptographic key from the secret
async function deriveKey(secret) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode("deterministic-salt"), // Using fixed salt for determinism
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
}

// Generate deterministic IV from access token
async function generateIV(accessToken) {
  const encoder = new TextEncoder();
  const data = encoder.encode(accessToken);
  const hash = await crypto.subtle.digest("SHA-256", data);
  // Use first 12 bytes of hash as IV
  return new Uint8Array(hash.slice(0, IV_LENGTH));
}

// Helper: Convert ArrayBuffer to base64url
function arrayBufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));

  // Convert to base64url (URL-safe base64)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// Helper: Convert base64url to ArrayBuffer
function base64UrlToArrayBuffer(base64url) {
  // Convert base64url back to base64
  const base64 = base64url
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(base64url.length + ((4 - (base64url.length % 4)) % 4), "=");

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encrypt access token to generate client_reference_id
 *
 * @param {string} token
 * @param {string} secret Minimum 16 characters
 * @returns {Promise<string>} cipherText
 */
export async function encryptToken(token, secret) {
  const key = await deriveKey(secret);
  const iv = await generateIV(token);
  const encoder = new TextEncoder();

  const encrypted = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv: iv },
    key,
    encoder.encode(token),
  );

  // Combine IV and encrypted data
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);

  // Convert to base64url for safe URL usage
  return arrayBufferToBase64Url(combined);
}

/**
 *
 * @param {string} cipherText
 * @param {string} secret same secret as used for `encryptToken`
 * @returns {Promise<string>} token
 */
export async function decryptToken(cipherText, secret) {
  const key = await deriveKey(secret);
  const combined = base64UrlToArrayBuffer(cipherText);

  // Extract IV and encrypted data
  const iv = combined.slice(0, IV_LENGTH);
  const encrypted = combined.slice(IV_LENGTH);

  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: iv },
    key,
    encrypted,
  );

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

// Usage example
async function example() {
  const accessToken = "your-access-token-here";
  const secret = "your-secret-key-minimum-16-chars"; // Should be at least 16 characters

  try {
    // Encrypt access token to get client_reference_id
    const clientReferenceId = await encryptToken(accessToken, secret);
    console.log("Client Reference ID:", clientReferenceId);

    // Decrypt client_reference_id back to access token
    const decryptedToken = await decryptToken(clientReferenceId, secret);
    console.log("Decrypted Access Token:", decryptedToken);

    // Verify they match
    console.log("Tokens match:", accessToken === decryptedToken);
  } catch (error) {
    console.error("Error:", error);
  }
}
