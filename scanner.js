const STORAGE_KEY = 'authenticators';
const videoEl = document.getElementById('video');
const statusEl = document.getElementById('status');
const stopBtn = document.getElementById('stop-btn');

let videoStream = null;
let detector = null;

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

async function loadAuths() {
  const r = await chrome.storage.local.get([STORAGE_KEY]);
  return r[STORAGE_KEY] || [];
}

async function saveAuths(list) {
  return chrome.storage.local.set({ [STORAGE_KEY]: list });
}

async function addAuthenticator(name, secret, issuer, digits = 6, period = 30, type = 'totp') {
  if (!secret) {
    statusEl.textContent = 'Invalid QR code: missing secret.';
    statusEl.className = 'error';
    return;
  }
  const cleanSecret = secret.toUpperCase().replace(/[\s=]/g, '');
  const authList = await loadAuths();
  const isDuplicate = authList.some(a => a.secret.toUpperCase().replace(/[\s=]/g, '') === cleanSecret);
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
    secret: secret,
    digits,
    period,
    type,
    imageDataUrl: ''
  });
  await saveAuths(authList);
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

startScanning();
