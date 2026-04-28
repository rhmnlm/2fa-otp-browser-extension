(() => {
  // Storage key
  const STORAGE_KEY = 'authenticators';

  // App state
  let authList = [];

  // Elements
  const authListEl = document.getElementById('auth-list');
  const startScanBtn = document.getElementById('start-scan');
  const stopScanBtn = document.getElementById('stop-scan');
  const videoEl = document.getElementById('video');
  const imageInput = document.getElementById('image-input');
  const imagePreview = document.getElementById('image-preview');
  const otpUrlInput = document.getElementById('otp-url');
  const importUrlBtn = document.getElementById('import-url-btn');
  const linkFeedback = document.getElementById('link-feedback');
  const qrFeedback = document.getElementById('qr-feedback');
  const uploadFeedback = document.getElementById('upload-feedback');

  let videoStream = null;
  let detector = null;

  // Init
  document.addEventListener('DOMContentLoaded', async () => {
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.getElementById(`tab-${tab}`).classList.add('active');
      });
    });

    // Import via URL
    importUrlBtn.addEventListener('click', () => {
      const url = otpUrlInput.value.trim();
      if (!url) return;
      const parsed = parseOtpAuthUrl(url);
      if (!parsed) {
        linkFeedback.textContent = 'Invalid otpauth URL';
        return;
      }
      addAuthenticator(parsed.name, parsed.secret, parsed.issuer, parsed.digits, parsed.period, parsed.type);
      otpUrlInput.value = '';
      linkFeedback.textContent = 'Imported from URL';
    });

    // Image import
    imageInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const dataUrl = await fileToDataURL(file);
      imagePreview.src = dataUrl;
      imagePreview.hidden = false;
      // Try to decode QR from image
      const code = await decodeFromImage(dataUrl);
      if (code) {
        const parsed = parseOtpAuthUrl(code) || decodeOtpFromLink(code);
        if (parsed) {
          addAuthenticator(parsed.name, parsed.secret, parsed.issuer, parsed.digits, parsed.period, parsed.type);
          uploadFeedback.textContent = 'Decoded and added from image';
        } else {
          uploadFeedback.textContent = 'Could not parse OTP URL from image';
        }
      } else {
        uploadFeedback.textContent = 'No QR code detected in image';
      }
    });

    // Start scanning
    startScanBtn.addEventListener('click', async () => {
      qrFeedback.textContent = '';
      await ensureBarcodeDetector();
      await startWebcamScan();
    });

    stopScanBtn.addEventListener('click', () => stopWebcam());

    // OTP URLs input
    otpUrlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        importUrlBtn.click();
      }
    });

    // Load existing authenticators
    await loadAuths();
    await renderAuthList();

    // Start timer to refresh OTPs
    setInterval(() => refreshAllOtps(), 1000);
  });

  // Helpers

  function parseOtpAuthUrl(url) {
    // Format: otpauth://totp/{issuer}:{account}?secret={secret}&issuer={issuer}&digits={digits}&period={period}
    try {
      const u = new URL(url);
      if (u.protocol !== 'otpauth:') return null;
      const type = u.host; // e.g., totp
      const label = decodeURIComponent(u.pathname).replace(/^\//, '');
      const name = label.includes(':') ? label.split(':').slice(0,2).join(':') : label;
      // Parse query
      const secret = u.searchParams.get('secret');
      const digits = parseInt(u.searchParams.get('digits') || '6', 10);
      const period = parseInt(u.searchParams.get('period') || '30', 10);
      const issuer = u.searchParams.get('issuer') || '';
      return {
        name: name || issuer || 'Authenticator',
        issuer: issuer || name || '',
        secret: secret,
        digits: digits,
        period: period,
        type: 'totp'
      };
    } catch (e) {
      return null;
    }
  }

  function decodeOtpFromLink(url) {
    // If a plain otpauth URL string is passed directly (without URL object)
    // This helper tries to reuse parseOtpAuthUrl; if fails, returns null
    return parseOtpAuthUrl(url);
  }

  async function ensureBarcodeDetector() {
    if (!('BarcodeDetector' in window)) {
      qrFeedback.textContent = 'BarcodeDetector not available in this browser. Please use image upload with decoding or a compatible browser.';
      detector = null;
      return;
    }
    if (!detector) {
      detector = new BarcodeDetector({ formats: ['qr_code'] });
    }
  }

  async function startWebcamScan() {
    if (videoStream) return;
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      videoEl.srcObject = videoStream;
      await videoEl.play();
      stopScanBtn.disabled = false;
      // Scan loop
      scanLoop();
    } catch (e) {
      qrFeedback.textContent = 'Unable to access webcam: ' + (e?.message || e);
    }
  }

  function stopWebcam() {
    if (videoStream) {
      videoStream.getTracks().forEach(t => t.stop());
      videoStream = null;
      videoEl.srcObject = null;
      stopScanBtn.disabled = true;
    }
  }

  async function scanLoop() {
    if (!videoEl || videoEl.readyState < 2) {
      requestAnimationFrame(scanLoop);
      return;
    }
    const w = videoEl.videoWidth;
    const h = videoEl.videoHeight;
    if (w && h) {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(videoEl, 0, 0, w, h);
      try {
        const bitmap = await createImageBitmap(canvas);
        const barcodes = await detector.detect(bitmap);
        if (barcodes && barcodes.length > 0) {
          const raw = barcodes[0].rawValue;
          if (raw) {
            // Stop after first successful scan
            stopWebcam();
            const parsed = parseOtpAuthUrl(raw) || decodeOtpFromLink(raw);
            if (parsed) {
              addAuthenticator(parsed.name, parsed.secret, parsed.issuer, parsed.digits, parsed.period, parsed.type);
              qrFeedback.textContent = 'Imported from QR (webcam).';
              return;
            } else {
              qrFeedback.textContent = 'Scanned data is not a valid otpauth URL.';
            }
          }
        } else {
          qrFeedback.textContent = 'Scanning...';
        }
      } catch (err) {
        // ignore
      }
    }
    requestAnimationFrame(scanLoop);
  }

  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
  }

  async function decodeFromImage(dataUrl) {
    if (!('BarcodeDetector' in window)) return null;
    try {
      const detectorLocal = new BarcodeDetector({ formats: ['qr_code'] });
      const img = new Image();
      img.src = dataUrl;
      await img.decode;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const bitmap = await createImageBitmap(canvas);
      const barcodes = await detectorLocal.detect(bitmap);
      if (barcodes && barcodes.length > 0) {
        return barcodes[0].rawValue;
      }
    } catch (e) {
      // ignore
    }
    return null;
  }

  async function addAuthenticator(name, secret, issuer, digits=6, period=30, type='totp') {
    if (!secret) {
      alert('Secret is required to add authenticator.');
      return;
    }
    const id = 'auth-' + Date.now() + '-' + Math.floor(Math.random()*1000);
    const a = {
      id,
      name: name || 'Authenticator',
      issuer: issuer || '',
      secret: secret,
      digits: digits,
      period: period,
      type: type,
      imageDataUrl: '' // optional
    };
    authList.push(a);
    await saveAuths();
    await renderAuthList();
  }

  async function loadAuths() {
    const r = await chrome.storage.local.get([STORAGE_KEY]);
    authList = r[STORAGE_KEY] || [];
  }

  async function saveAuths() {
    return chrome.storage.local.set({ [STORAGE_KEY]: authList });
  }

  async function loadAuthsAndRender() {
    await loadAuths();
  }

  async function renderAuthList() {
    authListEl.innerHTML = '';
    // Build items
    for (const a of authList) {
      const item = document.createElement('div');
      item.className = 'auth-item';
      item.id = a.id;

      const thumb = document.createElement('img');
      thumb.className = 'auth-thumb';
      if (a.imageDataUrl) thumb.src = a.imageDataUrl;
      else thumb.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(defaultAvatarSvg());

      const nameInput = document.createElement('input');
      nameInput.className = 'auth-name';
      nameInput.value = a.name;
      nameInput.addEventListener('blur', async () => {
        a.name = nameInput.value.trim() || a.name;
        await saveAuths();
      });

      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-btn';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', async () => {
        if (!confirm('Remove this authenticator?')) return;
        authList = authList.filter(x => x.id !== a.id);
        await saveAuths();
        await renderAuthList();
      });

      const setImageBtn = document.createElement('button');
      setImageBtn.className = 'image-btn';
      setImageBtn.textContent = 'Set image';
      const hiddenInput = document.createElement('input');
      hiddenInput.type = 'file';
      hiddenInput.accept = 'image/*';
      hiddenInput.style.display = 'none';
      hiddenInput.addEventListener('change', async (ev) => {
        const f = ev.target.files && ev.target.files[0];
        if (!f) return;
        const dataUrl = await fileToDataURL(f);
        a.imageDataUrl = dataUrl;
        thumb.src = dataUrl;
        await saveAuths();
      });
      setImageBtn.addEventListener('click', () => hiddenInput.click());

      // OTP area
      const otpWrap = document.createElement('div');
      otpWrap.className = 'otp-area';
      const otpCode = document.createElement('div');
      otpCode.className = 'auth-otp';
      otpCode.textContent = '------';
      otpCode.style.userSelect = 'text';
      otpCode.addEventListener('click', async () => {
        if (otpCode.textContent && otpCode.textContent !== '------') {
          try {
            await navigator.clipboard.writeText(otpCode.textContent);
            showToast('OTP copied to clipboard');
          } catch (e) {
            // ignore
          }
        }
      });

      // Countdown and progress
      const countSpan = document.createElement('span');
      countSpan.className = 'remaining';
      countSpan.id = `count-${a.id}`;

      const progressWrap = document.createElement('div');
      progressWrap.className = 'progress-wrap';
      const progressBar = document.createElement('div');
      progressBar.className = 'progress-bar';
      progressBar.id = `bar-${a.id}`;
      progressWrap.appendChild(progressBar);

      otpWrap.appendChild(otpCode);
      otpWrap.appendChild(countSpan);
      otpWrap.appendChild(progressWrap);

      // Assemble item
      const topRow = document.createElement('div');
      topRow.style.display = 'flex';
      topRow.style.alignItems = 'center';
      topRow.style.gap = '8px';
      topRow.appendChild(thumb);
      topRow.appendChild(nameInput);
      topRow.appendChild(removeBtn);
      topRow.appendChild(setImageBtn);
      topRow.appendChild(hiddenInput);
      item.appendChild(topRow);
      item.appendChild(otpWrap);

      // Append to list
      authListEl.appendChild(item);

      // Initial OTP render
      updateSingleOtp(a);
    }
  }

  function updateSingleOtp(a) {
    // Compute current OTP using WebCrypto
    const otpEl = document.querySelector(`#${escapeId(a.id)}.auth-otp`) || null;
    // The above selector is not robust in this simple approach; instead we locate via id-based elements
    const otpCodeEl = document.querySelector(`#${a.id} .auth-otp`);
    // If not found in the naive DOM, directly query by id from otpCodeEl after building
  }

  // Simple robust update using stored IDs
  function updateAllOtps() {
    const now = Date.now();
    for (const a of authList) {
      computeTotp(a.secret, a.digits || 6, a.period || 30, now)
        .then(code => {
          const otpEl = document.querySelector(`#${escapeId(a.id)} .auth-otp`);
          // Fallback: if we couldn't find, skip
          if (otpEl) {
            otpEl.textContent = code;
          }
          const countEl = document.getElementById(`count-${a.id}`);
          const barEl = document.getElementById(`bar-${a.id}`);
          if (countEl && barEl) {
            const period = a.period || 30;
            const elapsed = Math.floor(now / 1000) % period;
            const remaining = period - elapsed;
            countEl.textContent = `expires in ${remaining}s`;
            const pct = Math.max(0, Math.min(100, (remaining / period) * 100));
            barEl.style.width = pct + '%';
          }
        })
        .catch(() => {
          // ignore
        });
    }
  }

  function refreshAllOtps() {
    updateAllOtps();
  }

  function defaultAvatarSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
      <rect width="64" height="64" rx="8" ry="8" fill="#2a2a2a"/>
      <text x="50%" y="54%" fill="#888" font-family="Arial" font-size="9" text-anchor="middle">OTP</text>
    </svg>`;
  }

  function escapeId(id) {
    return id.replace(/[^a-zA-Z0-9_-]/g, '');
  }

  // OCR helpers

  function parseOtpAuthFromText(text) {
    // Try to parse otpauth URL-like text
    return parseOtpAuthUrl(text);
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
      const type = parsed.searchParams.get('issuer') ? 'totp' : 'totp';
      return {
        name: nameFromLabel || issuer || 'Authenticator',
        issuer: issuer || '',
        secret,
        digits,
        period,
        type
      };
    } catch (e) {
      return null;
    }
  }

  async function computeTotp(secretBase32, digits=6, period=30, timestampMs=Date.now()) {
    // WebCrypto-based HOTP/TOTP
    // base32 decode
    const keyBytes = base32Decode(secretBase32);
    let counter = Math.floor(timestampMs / 1000 / period);
    const counterBytes = new Uint8Array(8);
    for (let i = 7; i >= 0; i--) {
      counterBytes[i] = counter & 0xff;
      counter = Math.floor(counter / 256);
    }
    const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, counterBytes));
    const offset = mac[mac.length - 1] & 0x0f;
    const binCode = (
      ((mac[offset] & 0x7f) << 24) |
      ((mac[offset + 1] & 0xff) << 16) |
      ((mac[offset + 2] & 0xff) << 8) |
      (mac[offset + 3] & 0xff)
    ) >>> 0;
    const otp = binCode % (10 ** digits);
    return otp.toString().padStart(digits, '0');
  }

  // Base32 decode (RFC 4648)
  function base32Decode(input) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const clean = input.toUpperCase().replace(/[\s=]/g, '');
    const bytes = [];
    let buffer = 0;
    let bitsLeft = 0;
    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i];
      const idx = alphabet.indexOf(ch);
      if (idx < 0) continue;
      buffer = (buffer << 5) | idx;
      bitsLeft += 5;
      if (bitsLeft >= 8) {
        bytes.push((buffer >>> (bitsLeft - 8)) & 0xff);
        bitsLeft -= 8;
      }
    }
    return new Uint8Array(bytes);
  }

  async function addFromLinkAndImport(text) {
    const parsed = parseOtpAuthFromText(text);
    if (parsed) {
      await addAuthenticator(parsed.name, parsed.secret, parsed.issuer, parsed.digits, parsed.period, parsed.type);
      return true;
    }
    return false;
  }

  async function loadAndRenderInitial() {
    await loadAuths();
    await renderAuthList();
  }

  // Toast helper
  function showToast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    Object.assign(t.style, {
      position: 'fixed',
      bottom: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: '#333',
      color: '#fff',
      padding: '8px 12px',
      borderRadius: '6px',
      zIndex: 9999,
      opacity: 0,
      transition: 'opacity 0.3s',
    });
    document.body.appendChild(t);
    requestAnimationFrame(() => t.style.opacity = '1');
    setTimeout(() => {
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 350);
    }, 1500);
  }

})();
