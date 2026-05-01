// background.js
// Lightweight MV3 background to satisfy extension requirements.
// No long-running tasks here yet; everything is handled in the popup UI.
chrome.runtime.onInstalled.addListener(() => {
  console.log('OTP Vault: installed');
});
