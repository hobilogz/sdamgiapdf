// popup.js — Управление настройками Sdamgia PDF Cleaner

const storage = (chrome.storage && chrome.storage.sync) ? chrome.storage.sync : chrome.storage.local;

const defaults = {
  autoUncheckNumbers: true,
  cleanWatermark: true
};

function loadSettings() {
  storage.get(defaults, (items) => {
    document.getElementById('autoUncheckNumbers').checked = items.autoUncheckNumbers;
    document.getElementById('cleanWatermark').checked = items.cleanWatermark;
  });
}

function saveSettings() {
  const settings = {
    autoUncheckNumbers: document.getElementById('autoUncheckNumbers').checked,
    cleanWatermark: document.getElementById('cleanWatermark').checked
  };

  storage.set(settings, () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'settingsUpdated', settings }).catch(() => {});
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  document.getElementById('autoUncheckNumbers').addEventListener('change', saveSettings);
  document.getElementById('cleanWatermark').addEventListener('change', saveSettings);
});
