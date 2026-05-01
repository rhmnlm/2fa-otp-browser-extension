const PBKDF2_ITERATIONS = 100000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

const BASE32_MAX_CHARS = 256;

function validateBase32Secret(secret) {
  if (typeof secret !== 'string') {
    return { ok: false, error: 'Secret is required.' };
  }
  const normalized = secret.toUpperCase().replace(/[\s=]/g, '');
  if (normalized.length === 0) {
    return { ok: false, error: 'Secret is empty.' };
  }
  if (!/^[A-Z2-7]+$/.test(normalized)) {
    return { ok: false, error: 'Secret contains invalid Base32 characters (allowed: A–Z, 2–7).' };
  }
  if (normalized.length > BASE32_MAX_CHARS) {
    return { ok: false, error: `Secret is too long (maximum ${BASE32_MAX_CHARS} Base32 characters).` };
  }
  return { ok: true, normalized };
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function generateSalt() {
  return crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

function generateIv() {
  return crypto.getRandomValues(new Uint8Array(IV_BYTES));
}

async function deriveKey(pin, salt) {
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pin),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey']
  );
}

async function generateMasterKey() {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

async function encryptData(data, masterKey, iv) {
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    masterKey,
    plaintext
  );
  return arrayBufferToBase64(ciphertext);
}

async function decryptData(ciphertextBase64, masterKey, iv) {
  const ciphertext = base64ToArrayBuffer(ciphertextBase64);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    masterKey,
    ciphertext
  );
  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(plaintext));
}

async function isVaultSetup() {
  const stored = await chrome.storage.local.get('vault_key_wrap');
  return !!stored.vault_key_wrap;
}

async function setupVault(pin) {
  const salt = generateSalt();
  const vaultIv = generateIv();
  const derivedKey = await deriveKey(pin, salt);
  const masterKey = await generateMasterKey();

  const wrappedKey = await crypto.subtle.wrapKey(
    'raw',
    masterKey,
    derivedKey,
    { name: 'AES-GCM', iv: vaultIv }
  );

  await chrome.storage.local.set({
    vault_salt: arrayBufferToBase64(salt),
    vault_iv: arrayBufferToBase64(vaultIv),
    vault_key_wrap: arrayBufferToBase64(wrappedKey)
  });

  // Remove any legacy plaintext data
  await chrome.storage.local.remove('authenticators');

  // Initialize empty encrypted data
  const dataIv = generateIv();
  const ciphertext = await encryptData([], masterKey, dataIv);
  await chrome.storage.local.set({
    data_iv: arrayBufferToBase64(dataIv),
    data_ciphertext: ciphertext
  });

  return masterKey;
}

async function unlockVault(pin) {
  const stored = await chrome.storage.local.get([
    'vault_salt',
    'vault_iv',
    'vault_key_wrap',
    'data_iv',
    'data_ciphertext'
  ]);

  const salt = base64ToArrayBuffer(stored.vault_salt);
  const vaultIv = base64ToArrayBuffer(stored.vault_iv);
  const wrappedKey = base64ToArrayBuffer(stored.vault_key_wrap);

  const derivedKey = await deriveKey(pin, salt);

  const masterKey = await crypto.subtle.unwrapKey(
    'raw',
    wrappedKey,
    derivedKey,
    { name: 'AES-GCM', iv: vaultIv },
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  const dataIv = base64ToArrayBuffer(stored.data_iv);
  const data = await decryptData(stored.data_ciphertext, masterKey, dataIv);

  return { masterKey, data };
}

async function saveVault(data, masterKey) {
  const dataIv = generateIv();
  const ciphertext = await encryptData(data, masterKey, dataIv);
  await chrome.storage.local.set({
    data_iv: arrayBufferToBase64(dataIv),
    data_ciphertext: ciphertext
  });
}

async function changePin(oldPin, newPin) {
  const { masterKey, data } = await unlockVault(oldPin);

  const salt = generateSalt();
  const vaultIv = generateIv();
  const derivedKey = await deriveKey(newPin, salt);

  const wrappedKey = await crypto.subtle.wrapKey(
    'raw',
    masterKey,
    derivedKey,
    { name: 'AES-GCM', iv: vaultIv }
  );

  await chrome.storage.local.set({
    vault_salt: arrayBufferToBase64(salt),
    vault_iv: arrayBufferToBase64(vaultIv),
    vault_key_wrap: arrayBufferToBase64(wrappedKey)
  });

  return masterKey;
}
