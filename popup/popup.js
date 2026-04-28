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
  const onboardingSection = document.getElementById('onboarding-section');
  const newAuthBtn = document.getElementById('new-auth');

  let videoStream = null;
  let detector = null;
  const addSection = document.getElementById('add-section');

  // Init
  document.addEventListener('DOMContentLoaded', async () => {
    await loadAuths();
    await renderAuthList();
    toggleOnboarding();

    // Plus button: toggle add-section visibility
    newAuthBtn.addEventListener('click', () => {
      const isVisible = addSection.style.display !== 'none';
      addSection.style.display = isVisible ? 'none' : 'block';
    });

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
      toggleOnboarding();
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
          toggleOnboarding();
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

    // Start timer to refresh OTPs
    setInterval(() => refreshAllOtps(), 1000);
  });

  // Helpers

  function toggleOnboarding() {
    if (authList.length === 0) {
      onboardingSection.style.display = 'block';
      addSection.style.display = 'block';
    } else {
      onboardingSection.style.display = 'none';
      // Don't touch add-section here — user controls it via the + button
    }
  }

  function toggleOnboardingResetIfNeeded() {
    toggleOnboarding();
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
        toggleOnboardingResetIfNeeded();
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

      // Export button (⋮)
      const menuBtn = document.createElement('button');
      menuBtn.className = 'menu-btn';
      menuBtn.textContent = '⋮';
      menuBtn.title = 'Export';

      // Export panel (hidden by default)
      const exportPanel = document.createElement('div');
      exportPanel.className = 'export-panel';
      exportPanel.hidden = true;

      const otpauthUrl = buildOtpauthUrl(a);

      const exportTitle = document.createElement('div');
      exportTitle.className = 'export-title';
      exportTitle.textContent = 'Export';

      const linkRow = document.createElement('div');
      linkRow.className = 'export-link-row';
      const linkInput = document.createElement('input');
      linkInput.className = 'export-link-input';
      linkInput.readOnly = true;
      linkInput.value = otpauthUrl;
      const copyLinkBtn = document.createElement('button');
      copyLinkBtn.textContent = 'Copy';
      copyLinkBtn.className = 'export-copy-btn';
      copyLinkBtn.addEventListener('click', async () => {
        await navigator.clipboard.writeText(otpauthUrl);
        copyLinkBtn.textContent = 'Copied!';
        setTimeout(() => { copyLinkBtn.textContent = 'Copy'; }, 1500);
      });
      linkRow.appendChild(linkInput);
      linkRow.appendChild(copyLinkBtn);

      const qrCanvas = document.createElement('canvas');
      qrCanvas.className = 'export-qr';

      exportPanel.appendChild(exportTitle);
      exportPanel.appendChild(linkRow);
      exportPanel.appendChild(qrCanvas);

      menuBtn.addEventListener('click', () => {
        const opening = exportPanel.hidden;
        exportPanel.hidden = !opening;
        if (opening) renderQr(qrCanvas, otpauthUrl);
      });

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
      topRow.appendChild(menuBtn);
      topRow.appendChild(hiddenInput);
      item.appendChild(topRow);
      item.appendChild(otpWrap);
      item.appendChild(exportPanel);

      // Append to list
      authListEl.appendChild(item);

      // Initial OTP render
      updateSingleOtp(a);
    }
  }

  function updateSingleOtp(a) {
    computeTotp(a.secret, a.digits || 6, a.period || 30, Date.now())
      .then(code => {
        const otpEl = document.querySelector(`#${escapeId(a.id)} .auth-otp`);
        if (otpEl) otpEl.textContent = code;
        const countEl = document.getElementById(`count-${a.id}`);
        const barEl = document.getElementById(`bar-${a.id}`);
        if (countEl && barEl) {
          const period = a.period || 30;
          const elapsed = Math.floor(Date.now() / 1000) % period;
          const remaining = period - elapsed;
          countEl.textContent = `expires in ${remaining}s`;
          barEl.style.width = Math.max(0, Math.min(100, (remaining / period) * 100)) + '%';
        }
      })
      .catch(() => {});
  }

  async function ensureBarcodeDetector() {
    if (!('BarcodeDetector' in window)) {
      qrFeedback.textContent = 'BarcodeDetector not supported in this browser.';
      return false;
    }
    if (!detector) detector = new BarcodeDetector({ formats: ['qr_code'] });
    return true;
  }

  async function startWebcamScan() {
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      videoEl.srcObject = videoStream;
      startScanBtn.disabled = true;
      stopScanBtn.disabled = false;
      qrFeedback.textContent = 'Scanning…';
      scanLoop();
    } catch (e) {
      qrFeedback.textContent = 'Camera access denied or unavailable.';
    }
  }

  async function scanLoop() {
    if (!videoStream || !detector) return;
    try {
      const barcodes = await detector.detect(videoEl);
      if (barcodes && barcodes.length > 0) {
        const raw = barcodes[0].rawValue;
        const parsed = parseOtpAuthUrl(raw);
        if (parsed) {
          stopWebcam();
          await addAuthenticator(parsed.name, parsed.secret, parsed.issuer, parsed.digits, parsed.period, parsed.type);
          qrFeedback.textContent = 'QR code imported!';
          toggleOnboarding();
          return;
        }
      }
    } catch (e) {
      // keep scanning
    }
    if (videoStream) requestAnimationFrame(scanLoop);
  }

  function stopWebcam() {
    if (videoStream) {
      videoStream.getTracks().forEach(t => t.stop());
      videoStream = null;
    }
    videoEl.srcObject = null;
    startScanBtn.disabled = false;
    stopScanBtn.disabled = true;
  }

  // Simple robust update using stored IDs
  function updateAllOtps() {
    const now = Date.now();
    for (const a of authList) {
      computeTotp(a.secret, a.digits || 6, a.period || 30, now)
        .then(code => {
          const otpEl = document.querySelector(`#${escapeId(a.id)} .auth-otp`);
          if (otpEl) otpEl.textContent = code;
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

  function buildOtpauthUrl(a) {
    const label = a.issuer ? `${encodeURIComponent(a.issuer)}:${encodeURIComponent(a.name)}` : encodeURIComponent(a.name);
    const params = new URLSearchParams({
      secret: a.secret,
      issuer: a.issuer || a.name,
      digits: String(a.digits || 6),
      period: String(a.period || 30),
      algorithm: 'SHA1',
    });
    return `otpauth://totp/${label}?${params.toString()}`;
  }

  function renderQr(canvas, text) {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const cells = qr.getModuleCount();
    const cellSize = 4;
    const margin = 8;
    const size = cells * cellSize + margin * 2;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000000';
    for (let row = 0; row < cells; row++) {
      for (let col = 0; col < cells; col++) {
        if (qr.isDark(row, col)) {
          ctx.fillRect(margin + col * cellSize, margin + row * cellSize, cellSize, cellSize);
        }
      }
    }
  }

  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function decodeOtpFromLink(text) {
    return parseOtpAuthUrl(text);
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
