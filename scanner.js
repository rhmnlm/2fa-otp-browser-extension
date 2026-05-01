const videoEl = document.getElementById('video');
const statusEl = document.getElementById('status');
const stopBtn = document.getElementById('stop-btn');
const scannerSection = document.getElementById('scanner-section');
const unlockSection = document.getElementById('unlock-section');
const setupMessage = document.getElementById('setup-message');
const unlockPin = document.getElementById('unlock-pin');
const unlockBtn = document.getElementById('unlock-btn');
const unlockError = document.getElementById('unlock-error');
const closeBtn = document.getElementById('close-btn');

let videoStream = null;
let detector = null;
let sessionMasterKey = null;
let authList = [];

async function init() {
  const vaultExists = await isVaultSetup();
  if (!vaultExists) {
    scannerSection.classList.add('hidden');
    setupMessage.classList.remove('hidden');
    return;
  }

  scannerSection.classList.add('hidden');
  unlockSection.classList.remove('hidden');
  unlockPin.focus();

  unlockBtn.addEventListener('click', onUnlock);
  unlockPin.addEventListener('keydown', (e) => { if (e.key === 'Enter') onUnlock(); });
  closeBtn.addEventListener('click', () => window.close());
}

async function onUnlock() {
  const pin = unlockPin.value.trim();
  if (!pin) { unlockError.textContent = 'PIN is required'; return; }

  try {
    const result = await unlockVault(pin);
    sessionMasterKey = result.masterKey;
    authList = result.data;
    unlockSection.classList.add('hidden');
    scannerSection.classList.remove('hidden');
    startScanning();
  } catch (e) {
    unlockError.textContent = 'Wrong PIN';
  }
}

async function saveAuths() {
  if (!sessionMasterKey) return;
  return saveVault(authList, sessionMasterKey);
}

function parseOtpAuthUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'otpauth:') return null;
    const label = decodeURIComponent(parsed.pathname).replace(/^\//, '');
    const issuerFromLabel = label.includes(':') ? label.split(':')[0] : '';
    const nameFromLabel = label.includes(':') ? label.split(':')[1] : label;
    const secret = parsed.searchParams.get('secret');
    const digits = parseInt(parsed.searchParams.get('digits') || '6', 10);
    const period = parseInt(parsed.searchParams.get('period') || '30', 10);
    const issuer = parsed.searchParams.get('issuer') || issuerFromLabel;
    return {
      name: nameFromLabel || issuer || 'Authenticator',
      issuer: issuer || '',
      secret,
      digits,
      period,
      type: 'totp'
    };
  } catch (e) {
    return null;
  }
}

async function addAuthenticator(name, secret, issuer, digits = 6, period = 30, type = 'totp') {
  if (!secret) {
    statusEl.textContent = 'Invalid QR code: missing secret.';
    statusEl.className = 'error';
    return;
  }
  const validation = validateBase32Secret(secret);
  if (!validation.ok) {
    statusEl.textContent = `Invalid QR code: ${validation.error}`;
    statusEl.className = 'error';
    return;
  }
  const normalizedSecret = validation.normalized;
  const isDuplicate = authList.some(a =>
    a.secret.toUpperCase().replace(/[\s=]/g, '') === normalizedSecret &&
    (a.issuer || '').toLowerCase() === (issuer || '').toLowerCase() &&
    (a.name || '').toLowerCase() === (name || '').toLowerCase()
  );
  if (isDuplicate) {
    statusEl.textContent = 'This authenticator already exists in your vault.';
    statusEl.className = 'error';
    return;
  }
  const id = 'auth-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  authList.push({
    id,
    name: name || 'Authenticator',
    issuer: issuer || '',
    secret: normalizedSecret,
    digits,
    period,
    type,
    imageDataUrl: ''
  });
  await saveAuths();
  statusEl.textContent = 'QR code imported! You can close this tab.';
  statusEl.className = 'success';
  stopBtn.textContent = 'Close';
  stopWebcam();
}

async function ensureBarcodeDetector() {
  if (!('BarcodeDetector' in window)) {
    statusEl.textContent = 'BarcodeDetector not supported in this browser.';
    statusEl.className = 'error';
    return false;
  }
  try {
    const supported = await BarcodeDetector.getSupportedFormats();
    if (!supported.includes('qr_code')) {
      statusEl.textContent = 'QR code scanning not supported in this browser.';
      statusEl.className = 'error';
      return false;
    }
    detector = new BarcodeDetector({ formats: ['qr_code'] });
    return true;
  } catch (e) {
    statusEl.textContent = 'Failed to initialize barcode detector.';
    statusEl.className = 'error';
    return false;
  }
}

async function startScanning() {
  const hasDetector = await ensureBarcodeDetector();
  if (!hasDetector) return;

  try {
    videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    videoEl.srcObject = videoStream;
    await videoEl.play();
    statusEl.textContent = 'Scanning… Point your camera at a QR code.';
    scanLoop();
  } catch (e) {
    statusEl.textContent = 'Camera access denied or unavailable. Please allow camera access and try again.';
    statusEl.className = 'error';
  }
}

let scanning = false;
async function scanLoop() {
  if (!videoStream || !detector || scanning) return;
  if (videoEl.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    requestAnimationFrame(scanLoop);
    return;
  }
  scanning = true;
  try {
    const barcodes = await detector.detect(videoEl);
    if (barcodes && barcodes.length > 0) {
      const raw = barcodes[0].rawValue;
      const parsed = parseOtpAuthUrl(raw);
      if (parsed) {
        await addAuthenticator(parsed.name, parsed.secret, parsed.issuer, parsed.digits, parsed.period, parsed.type);
        return;
      }
      statusEl.textContent = 'Invalid QR code. Expected an otpauth:// URL.';
    }
  } catch (e) {
    // keep scanning
  }
  scanning = false;
  if (videoStream) setTimeout(() => requestAnimationFrame(scanLoop), 150);
}

function stopWebcam() {
  if (videoStream) {
    videoStream.getTracks().forEach(t => t.stop());
    videoStream = null;
  }
  videoEl.srcObject = null;
}

stopBtn.addEventListener('click', () => {
  stopWebcam();
  window.close();
});

window.addEventListener('beforeunload', () => stopWebcam());

init();
