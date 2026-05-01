(() => {
  // App state
  let authList = [];
  let sessionMasterKey = null;
  let autoLockTimer = null;
  let searchQuery = '';
  let pendingAvatarAuthId = null;
  const AUTO_LOCK_MS = 5 * 60 * 1000;

  // Elements
  const authListEl = document.getElementById('auth-list');
  const searchInput = document.getElementById('search-input');
  const imageInput = document.getElementById('image-input');
  const avatarInput = document.getElementById('avatar-input');
  const onboardingSection = document.getElementById('onboarding-section');
  const newAuthBtn = document.getElementById('new-auth');
  const addDropdown = document.getElementById('add-dropdown');
  const addScanBtn = document.getElementById('add-scan');
  const addUploadBtn = document.getElementById('add-upload');
  const addLinkBtn = document.getElementById('add-link');

  // URL dialog elements
  const urlDialogOverlay = document.getElementById('url-dialog-overlay');
  const urlDialogInput = document.getElementById('url-dialog-input');
  const urlDialogImport = document.getElementById('url-dialog-import');
  const urlDialogCancel = document.getElementById('url-dialog-cancel');
  const urlDialogError = document.getElementById('url-dialog-error');

  // Vault UI elements
  const setupOverlay = document.getElementById('setup-overlay');
  const unlockOverlay = document.getElementById('unlock-overlay');
  const setupPin = document.getElementById('setup-pin');
  const setupPinConfirm = document.getElementById('setup-pin-confirm');
  const setupBtn = document.getElementById('setup-btn');
  const setupError = document.getElementById('setup-error');
  const unlockPin = document.getElementById('unlock-pin');
  const unlockBtn = document.getElementById('unlock-btn');
  const unlockError = document.getElementById('unlock-error');
  const lockBtn = document.getElementById('lock-btn');

  // Confirm modal elements
  const confirmOverlay = document.getElementById('confirm-overlay');
  const confirmMessage = document.getElementById('confirm-message');
  const confirmOk = document.getElementById('confirm-ok');
  const confirmCancel = document.getElementById('confirm-cancel');

  // Init
  document.addEventListener('DOMContentLoaded', async () => {
    const vaultExists = await isVaultSetup();
    if (!vaultExists) {
      showSetup();
    } else {
      showUnlock();
    }

    // Vault UI handlers
    setupBtn.addEventListener('click', onSetup);
    setupPin.addEventListener('keydown', (e) => { if (e.key === 'Enter') setupPinConfirm.focus(); });
    setupPinConfirm.addEventListener('keydown', (e) => { if (e.key === 'Enter') onSetup(); });
    unlockBtn.addEventListener('click', onUnlock);
    unlockPin.addEventListener('keydown', (e) => { if (e.key === 'Enter') onUnlock(); });
    lockBtn.addEventListener('click', lockVaultLocal);

    // Reset auto-lock on interaction
    document.addEventListener('click', resetAutoLock);
    document.addEventListener('keydown', resetAutoLock);
    document.addEventListener('input', resetAutoLock);

    // Plus button: toggle add dropdown
    newAuthBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = addDropdown.style.display !== 'none';
      addDropdown.style.display = isVisible ? 'none' : 'block';
    });

    // Add dropdown items
    addScanBtn.addEventListener('click', () => {
      addDropdown.style.display = 'none';
      chrome.tabs.create({ url: chrome.runtime.getURL('scanner.html'), active: true });
    });

    addUploadBtn.addEventListener('click', () => {
      addDropdown.style.display = 'none';
      imageInput.click();
    });

    addLinkBtn.addEventListener('click', () => {
      addDropdown.style.display = 'none';
      urlDialogInput.value = '';
      urlDialogError.textContent = '';
      urlDialogOverlay.classList.remove('hidden');
      urlDialogInput.focus();
    });

    // URL dialog handlers
    urlDialogCancel.addEventListener('click', () => {
      urlDialogOverlay.classList.add('hidden');
    });

    urlDialogImport.addEventListener('click', async () => {
      const url = urlDialogInput.value.trim();
      if (!url) return;
      const parsed = parseOtpAuthUrl(url);
      if (!parsed) {
        urlDialogError.textContent = 'Invalid otpauth URL';
        return;
      }
      const added = await addAuthenticator(parsed.name, parsed.secret, parsed.issuer, parsed.digits, parsed.period, parsed.type);
      if (added) {
        urlDialogInput.value = '';
        urlDialogError.textContent = '';
        urlDialogOverlay.classList.add('hidden');
        showToast('Imported from URL');
        toggleOnboarding();
      }
    });

    urlDialogInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        urlDialogImport.click();
      }
    });

    // Image import
    imageInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const dataUrl = await fileToDataURL(file);
      const code = await decodeFromImage(dataUrl);
      if (code) {
        const parsed = parseOtpAuthUrl(code) || decodeOtpFromLink(code);
        if (parsed) {
          const added = await addAuthenticator(parsed.name, parsed.secret, parsed.issuer, parsed.digits, parsed.period, parsed.type);
          if (added) {
            showToast('Decoded and added from image');
            toggleOnboarding();
          }
        } else {
          showToast('Could not parse OTP URL from image');
        }
      } else {
        showToast('No QR code detected in image');
      }
      imageInput.value = '';
    });

    // Avatar change
    avatarInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file || !pendingAvatarAuthId) return;
      try {
        const dataUrl = await resizeImageToDataURL(file, 128);
        const auth = authList.find(x => x.id === pendingAvatarAuthId);
        if (auth) {
          auth.imageDataUrl = dataUrl;
          await saveAuths();
          await renderAuthList();
          showToast('Image updated');
        }
      } catch (err) {
        showToast('Failed to process image');
      }
      pendingAvatarAuthId = null;
      avatarInput.value = '';
    });

    // Search
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value;
      renderAuthList();
    });

    // Close all dropdown menus when clicking outside
    document.addEventListener('click', () => {
      document.querySelectorAll('.export-dropdown').forEach(d => d.style.display = 'none');
      addDropdown.style.display = 'none';
    });

    // Start timer to refresh OTPs
    setInterval(() => refreshAllOtps(), 1000);
  });

  // Helpers

  function toggleOnboarding() {
    if (authList.length === 0) {
      onboardingSection.style.display = 'block';
    } else {
      onboardingSection.style.display = 'none';
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
      await img.decode();
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
      return false;
    }

    const validation = validateBase32Secret(secret);
    if (!validation.ok) {
      alert(`Invalid secret: ${validation.error}`);
      return false;
    }
    const normalizedSecret = validation.normalized;

    // Duplicate Check — exact match on secret + issuer + name
    const isDuplicate = authList.some(a =>
      a.secret.toUpperCase().replace(/[\s=]/g, '') === normalizedSecret &&
      (a.issuer || '').toLowerCase() === (issuer || '').toLowerCase() &&
      (a.name || '').toLowerCase() === (name || '').toLowerCase()
    );

    if (isDuplicate) {
      alert('This authenticator already exists in your vault.');
      return false;
    }

    const id = 'auth-' + Date.now() + '-' + Math.floor(Math.random()*1000);
    const a = {
      id,
      name: name || 'Authenticator',
      issuer: issuer || '',
      secret: normalizedSecret,
      digits: digits,
      period: period,
      type: type,
      imageDataUrl: '' // optional
    };
    authList.push(a);
    await saveAuths();
    await renderAuthList();
    return true;
  }

  async function saveAuths() {
    if (!sessionMasterKey) return;
    return saveVault(authList, sessionMasterKey);
  }

  // Vault UI helpers

  function showSetup() {
    setupOverlay.classList.remove('hidden');
    unlockOverlay.classList.add('hidden');
    lockBtn.hidden = true;
    setupPin.focus();
  }

  function showUnlock() {
    unlockOverlay.classList.remove('hidden');
    setupOverlay.classList.add('hidden');
    lockBtn.hidden = true;
    unlockPin.focus();
  }

  function hideOverlays() {
    setupOverlay.classList.add('hidden');
    unlockOverlay.classList.add('hidden');
    lockBtn.hidden = false;
  }

  async function onSetup() {
    const pin = setupPin.value.trim();
    const confirm = setupPinConfirm.value.trim();
    if (!pin) { setupError.textContent = 'PIN is required'; return; }
    if (pin !== confirm) { setupError.textContent = 'PINs do not match'; return; }
    if (pin.length < 4) { setupError.textContent = 'PIN must be at least 4 characters'; return; }

    try {
      sessionMasterKey = await setupVault(pin);
      authList = [];
      setupPin.value = '';
      setupPinConfirm.value = '';
      setupError.textContent = '';
      hideOverlays();
      await renderAuthList();
      toggleOnboarding();
      startAutoLock();
    } catch (e) {
      setupError.textContent = 'Failed to create vault';
    }
  }

  async function onUnlock() {
    const pin = unlockPin.value.trim();
    if (!pin) { unlockError.textContent = 'PIN is required'; return; }

    try {
      const result = await unlockVault(pin);
      sessionMasterKey = result.masterKey;
      authList = result.data;
      unlockPin.value = '';
      unlockError.textContent = '';
      hideOverlays();
      await renderAuthList();
      toggleOnboarding();
      startAutoLock();
    } catch (e) {
      unlockError.textContent = 'Wrong PIN';
    }
  }

  function lockVaultLocal() {
    sessionMasterKey = null;
    authList = [];
    clearAutoLock();
    renderAuthList();
    showUnlock();
  }

  function startAutoLock() {
    clearAutoLock();
    autoLockTimer = setTimeout(lockVaultLocal, AUTO_LOCK_MS);
  }

  function clearAutoLock() {
    if (autoLockTimer) {
      clearTimeout(autoLockTimer);
      autoLockTimer = null;
    }
  }

  function resetAutoLock() {
    if (sessionMasterKey) {
      startAutoLock();
    }
  }

  function showConfirm(message, okText = 'OK', isDanger = false) {
    return new Promise((resolve) => {
      confirmMessage.textContent = message;
      confirmOk.textContent = okText;
      confirmOk.classList.toggle('danger', isDanger);
      confirmOverlay.classList.remove('hidden');

      const onOk = () => {
        confirmOverlay.classList.add('hidden');
        cleanup();
        resolve(true);
      };
      const onCancel = () => {
        confirmOverlay.classList.add('hidden');
        cleanup();
        resolve(false);
      };
      const cleanup = () => {
        confirmOk.removeEventListener('click', onOk);
        confirmCancel.removeEventListener('click', onCancel);
      };

      confirmOk.addEventListener('click', onOk);
      confirmCancel.addEventListener('click', onCancel);
    });
  }

  async function resizeImageToDataURL(file, maxSize = 128) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = maxSize;
        canvas.height = maxSize;
        const ctx = canvas.getContext('2d');
        const scale = Math.max(maxSize / img.width, maxSize / img.height);
        const drawWidth = img.width * scale;
        const drawHeight = img.height * scale;
        const x = (maxSize - drawWidth) / 2;
        const y = (maxSize - drawHeight) / 2;
        ctx.drawImage(img, x, y, drawWidth, drawHeight);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = reject;
      const reader = new FileReader();
      reader.onload = e => { img.src = e.target.result; };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function getFilteredAccounts() {
    if (!searchQuery.trim()) return authList;
    const q = searchQuery.toLowerCase();
    return authList.filter(a =>
      (a.issuer || '').toLowerCase().includes(q) ||
      (a.name || '').toLowerCase().includes(q)
    );
  }

  function iconSvg(name, size = 16) {
    const paths = {
      'ellipsis-vertical': '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
      'link': '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
      'qr-code': '<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M15 21v.01"/><path d="M11 21v-5a2 2 0 0 1 2-2h3v-3h-3a2 2 0 0 1-2-2V3"/>',
      'trash-2': '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
      'copy': '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
      'check': '<path d="M20 6 9 17l-5-5"/>',
      'image': '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
      'x-circle': '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
    };
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ''}</svg>`;
  }

  async function renderAuthList() {
    authListEl.innerHTML = '';
    const filtered = getFilteredAccounts();

    if (filtered.length === 0 && authList.length > 0) {
      const empty = document.createElement('div');
      empty.style.textAlign = 'center';
      empty.style.color = 'var(--muted)';
      empty.style.padding = '40px 0';
      empty.textContent = 'No authenticators found.';
      authListEl.appendChild(empty);
    }

    for (const a of filtered) {
      const item = document.createElement('div');
      item.className = 'auth-item';
      item.id = a.id;

      // Avatar
      const avatar = document.createElement('div');
      avatar.className = 'auth-avatar';
      avatar.style.background = '#18181B';
      if (a.imageDataUrl) {
        const img = document.createElement('img');
        img.src = a.imageDataUrl;
        avatar.appendChild(img);
      } else {
        avatar.textContent = (a.issuer || a.name || '?').charAt(0).toLowerCase();
      }

      // Details
      const details = document.createElement('div');
      details.className = 'auth-details';
      const issuer = document.createElement('h3');
      issuer.className = 'auth-issuer';
      issuer.textContent = a.issuer || a.name || 'Authenticator';
      issuer.title = issuer.textContent;
      const account = document.createElement('p');
      account.className = 'auth-account';
      account.textContent = a.name || '';
      account.title = account.textContent;
      details.appendChild(issuer);
      details.appendChild(account);

      // Info group
      const info = document.createElement('div');
      info.className = 'auth-info';
      info.appendChild(avatar);
      info.appendChild(details);

      // Menu button
      const menuBtn = document.createElement('button');
      menuBtn.className = 'menu-btn';
      menuBtn.title = 'More options';
      menuBtn.innerHTML = iconSvg('ellipsis-vertical', 18);
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.export-dropdown').forEach(d => d.style.display = 'none');
        const currentDisplay = dropdown.style.display;
        dropdown.style.display = currentDisplay === 'block' ? 'none' : 'block';
      });

      // Dropdown
      const dropdown = document.createElement('div');
      dropdown.className = 'export-dropdown';
      dropdown.style.display = 'none';
      dropdown.addEventListener('click', (e) => e.stopPropagation());

      // Export URL
      const exportUrlBtn = document.createElement('button');
      exportUrlBtn.className = 'export-dropdown-item';
      exportUrlBtn.innerHTML = `${iconSvg('link', 14)} Export as URL`;
      exportUrlBtn.addEventListener('click', async () => {
        dropdown.style.display = 'none';
        const ok = await showConfirm('This will expose the raw secret in plain text. Anyone with this URL can generate your OTP codes. Continue?', 'Export', false);
        if (!ok) return;
        const otpauthUrl = buildOtpauthUrl(a);
        try {
          await navigator.clipboard.writeText(otpauthUrl);
          showToast('URL copied to clipboard');
        } catch (err) {
          showToast('Failed to copy URL');
        }
      });

      // Export QR
      const exportQrBtn = document.createElement('button');
      exportQrBtn.className = 'export-dropdown-item';
      exportQrBtn.innerHTML = `${iconSvg('qr-code', 14)} Export as QR`;
      exportQrBtn.addEventListener('click', async () => {
        dropdown.style.display = 'none';
        const ok = await showConfirm('This will expose the raw secret in plain text. Anyone with this QR code can generate your OTP codes. Continue?', 'Export', false);
        if (!ok) return;
        const otpauthUrl = buildOtpauthUrl(a);
        const canvas = document.createElement('canvas');
        renderQr(canvas, otpauthUrl);
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = `${a.name || 'otp'}-qr.png`;
        link.click();
      });

      // Delete
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'export-dropdown-item danger';
      deleteBtn.innerHTML = `${iconSvg('trash-2', 14)} Delete`;
      deleteBtn.addEventListener('click', async () => {
        dropdown.style.display = 'none';
        const ok = await showConfirm('Remove this authenticator?', 'Delete', true);
        if (!ok) return;
        authList = authList.filter(x => x.id !== a.id);
        await saveAuths();
        await renderAuthList();
        toggleOnboardingResetIfNeeded();
      });

      dropdown.appendChild(exportUrlBtn);
      dropdown.appendChild(exportQrBtn);

      // Change image
      const changeImgBtn = document.createElement('button');
      changeImgBtn.className = 'export-dropdown-item';
      changeImgBtn.innerHTML = `${iconSvg('image', 14)} Change Image`;
      changeImgBtn.addEventListener('click', () => {
        dropdown.style.display = 'none';
        pendingAvatarAuthId = a.id;
        avatarInput.click();
      });
      dropdown.appendChild(changeImgBtn);

      // Remove image
      if (a.imageDataUrl) {
        const removeImgBtn = document.createElement('button');
        removeImgBtn.className = 'export-dropdown-item';
        removeImgBtn.innerHTML = `${iconSvg('x-circle', 14)} Remove Image`;
        removeImgBtn.addEventListener('click', async () => {
          dropdown.style.display = 'none';
          a.imageDataUrl = '';
          await saveAuths();
          await renderAuthList();
          showToast('Image removed');
        });
        dropdown.appendChild(removeImgBtn);
      }

      const sep = document.createElement('div');
      sep.style.height = '1px';
      sep.style.background = 'var(--border)';
      sep.style.margin = '4px 12px';
      dropdown.appendChild(sep);
      dropdown.appendChild(deleteBtn);

      // Menu wrapper
      const menuWrap = document.createElement('div');
      menuWrap.style.position = 'relative';
      menuWrap.appendChild(menuBtn);
      menuWrap.appendChild(dropdown);

      // Copy button
      const copyBtn = document.createElement('button');
      copyBtn.className = 'copy-btn';
      const codeSpan = document.createElement('span');
      codeSpan.className = 'copy-code';
      codeSpan.textContent = '------';
      const hoverOverlay = document.createElement('span');
      hoverOverlay.className = 'copy-overlay hover-state';
      hoverOverlay.innerHTML = `${iconSvg('copy', 14)} Copy`;
      const copiedOverlay = document.createElement('span');
      copiedOverlay.className = 'copy-overlay copied-state';
      copiedOverlay.innerHTML = `${iconSvg('check', 14)} Copied`;
      copyBtn.appendChild(codeSpan);
      copyBtn.appendChild(hoverOverlay);
      copyBtn.appendChild(copiedOverlay);

      copyBtn.addEventListener('click', () => {
        const code = codeSpan.textContent.replace(/\s/g, '');
        if (!code || code === '------') return;
        navigator.clipboard.writeText(code).then(() => {
          copyBtn.classList.add('copied');
          setTimeout(() => copyBtn.classList.remove('copied'), 2000);
        }).catch(() => showToast('Failed to copy OTP'));
      });

      // Actions group
      const actions = document.createElement('div');
      actions.className = 'auth-actions';
      actions.appendChild(menuWrap);
      actions.appendChild(copyBtn);

      // Row
      const row = document.createElement('div');
      row.className = 'auth-item-row';
      row.appendChild(info);
      row.appendChild(actions);

      // Progress bar
      const progressBar = document.createElement('div');
      progressBar.className = 'progress-bar';
      progressBar.id = `bar-${a.id}`;

      item.appendChild(row);
      item.appendChild(progressBar);

      authListEl.appendChild(item);
      updateSingleOtp(a);
    }
  }

  function formatCode(code) {
    const mid = Math.floor(code.length / 2);
    return code.slice(0, mid) + ' ' + code.slice(mid);
  }

  function updateSingleOtp(a) {
    computeTotp(a.secret, a.digits || 6, a.period || 30, Date.now())
      .then(code => {
        const el = document.querySelector(`#${escapeId(a.id)} .copy-code`);
        if (el) el.textContent = formatCode(code);
      })
      .catch(() => {});
  }

  // Update OTP codes only (runs every 1s)
  function updateAllOtps() {
    const now = Date.now();
    for (const a of authList) {
      computeTotp(a.secret, a.digits || 6, a.period || 30, now)
        .then(code => {
          const el = document.querySelector(`#${escapeId(a.id)} .copy-code`);
          if (el) el.textContent = formatCode(code);
        })
        .catch(() => {});
    }
  }

  function refreshAllOtps() {
    updateAllOtps();
  }

  // Smooth visual updates for progress bar (runs on rAF)
  function tickVisuals() {
    const now = Date.now();
    let minRemainingSec = 30;
    for (const a of authList) {
      const period = a.period || 30;
      const periodMs = period * 1000;
      const elapsedMs = now % periodMs;
      const remainingMs = periodMs - elapsedMs;
      const remainingSec = Math.ceil(remainingMs / 1000);
      const pct = (remainingMs / periodMs) * 100;
      if (remainingSec < minRemainingSec) minRemainingSec = remainingSec;

      const barEl = document.getElementById(`bar-${a.id}`);
      if (barEl) {
        barEl.style.width = Math.max(0, Math.min(100, pct)) + '%';
        if (pct > 60) {
          barEl.style.background = 'linear-gradient(90deg, #22c55e, #4ade80)';
        } else if (pct > 30) {
          barEl.style.background = '#f59e0b';
        } else {
          barEl.style.background = '#ef4444';
        }
      }
    }
    const footerTimer = document.getElementById('footer-timer');
    if (footerTimer) {
      footerTimer.textContent = `Next code in ${minRemainingSec}s`;
    }
    requestAnimationFrame(tickVisuals);
  }

  // Start the smooth animation loop
  requestAnimationFrame(tickVisuals);

  function escapeId(id) {
    return id.replace(/[^a-zA-Z0-9_-]/g, '');
  }

  // OCR helpers

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
      background: '#18181B',
      color: '#fff',
      padding: '10px 16px',
      borderRadius: '8px',
      fontSize: '13px',
      fontWeight: '500',
      boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
      zIndex: 9999,
      opacity: 0,
      transition: 'opacity 0.3s',
    });
    document.body.appendChild(t);
    requestAnimationFrame(() => t.style.opacity = '1');
    setTimeout(() => {
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 350);
    }, 2000);
  }

})();