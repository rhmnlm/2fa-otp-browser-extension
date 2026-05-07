# OTP Vault

A Chromium browser extension for locally managing TOTP codes. Supports webcam QR scanning, QR image upload, and otpauth URL import. Ideal for users handling many work OTPs. Encrypted at rest.

## Features

- **Add authenticators** — Scan a QR code with your webcam, upload a QR image, or paste an otpauth URL
- **Local-only storage** — All data stays on your device in `chrome.storage.local`
- **Encrypted at rest** — Your vault is protected by a PIN you choose
- **Copy codes instantly** — Click any OTP to copy it to your clipboard
- **Visual countdown** — A progress bar shows how long until the next code
- **Organize** — Rename accounts and attach a custom image to each authenticator
- **Export** — Copy an otpauth URL or save a QR code for backup

## Installation

1. Download or clone this repository to your computer  
   `git clone https://github.com/rhmnlm/2fa-otp-browser-extension.git`

2. Open Chrome and go to `chrome://extensions/`

3. Turn on **Developer mode** in the top-right corner  
   ![Enable Developer Mode](https://raw.githubusercontent.com/rhmnlm/assets/9ef5674e5e1b3c883d73dcbae8b0acd0ea8bc229/screenshots/enable-developer-mode-in-browser.png)

4. Click **Load unpacked** and select the extension folder you downloaded  
   ![Locate Directory](https://raw.githubusercontent.com/rhmnlm/assets/9ef5674e5e1b3c883d73dcbae8b0acd0ea8bc229/screenshots/locate-directory.png)

5. The extension is now installed and ready to use  
   ![Extension Installed](https://raw.githubusercontent.com/rhmnlm/assets/9ef5674e5e1b3c883d73dcbae8b0acd0ea8bc229/screenshots/extension-installed.png)

## Getting Started

1. Click the OTP Vault icon in your browser toolbar
2. On first launch, create a PIN to encrypt your vault  
   ![Create PIN](https://raw.githubusercontent.com/rhmnlm/assets/9ef5674e5e1b3c883d73dcbae8b0acd0ea8bc229/screenshots/tutorial-onboarding-create-pin.png)
3. Add your first authenticator by scanning a QR code, uploading an image, or pasting an otpauth URL  
   ![Creating First TOTP](https://raw.githubusercontent.com/rhmnlm/assets/9ef5674e5e1b3c883d73dcbae8b0acd0ea8bc229/screenshots/tutorial-creating-first-totp.png)
4. Your OTP codes will appear with a live countdown timer  
   ![OTP Added](https://raw.githubusercontent.com/rhmnlm/assets/9ef5674e5e1b3c883d73dcbae8b0acd0ea8bc229/screenshots/tutorial-otp-added.png)

## Exporting & Backups

You can export any authenticator as an otpauth URL or QR code for backup purposes. Keep these exports secure — anyone with the URL or QR code can generate your OTP codes.

![Exporting TOTP](https://raw.githubusercontent.com/rhmnlm/assets/9ef5674e5e1b3c883d73dcbae8b0acd0ea8bc229/screenshots/tutorial-exporting-totp.png)

## Security Notes

- Your vault is encrypted at rest using your PIN
- TOTP codes are generated on-device using HMAC-SHA1 per RFC 4226
- No data is sent to external servers
- QR code scanning uses the browser's built-in BarcodeDetector when available
