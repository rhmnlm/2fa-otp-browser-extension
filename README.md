# OTP Vault (Chrome MV3)

A tiny, self-contained Chrome extension to manage OTP codes locally.

What it does
- Add new authenticators by scanning a QR with webcam, uploading an image, or via otpauth URL links
- Remove authenticators
- Rename authenticators and attach an image per authenticator
- Copy OTP to clipboard on click, with a countdown timer and a progress bar
- Local storage in chrome.storage.local

How to build / install
1) Load unpacked extension in Chrome:
   - Chrome menu > More tools > Extensions > Developer mode ON
   - Click 'Load unpacked' and select the extension folder
2) Optional packaging:
   - Use Chrome's Pack extension feature to generate a signed crx

Testing tips
- Add an authenticator via otpauth URL: otpauth://totp/Issuer:Account?secret=JBSWY3DPEHPK3PXP&issuer=Issuer&digits=6&period=30
- Use QR scanning (webcam) or image upload to read a QR that encodes such a URL
- Click the displayed OTP to copy to clipboard
- Rename and attach an image per authenticator

Notes
- BarcodeDetector is used when available; otherwise, you can paste URLs or upload images containing QR codes
- TOTPs generated on-device using HMAC-SHA1 per RFC 4226

