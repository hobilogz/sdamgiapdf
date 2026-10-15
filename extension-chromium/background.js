// background.js — Service worker для расширения Sdamgia PDF Cleaner

chrome.action.onClicked.addListener((tab) => {
  if (!tab.url || !tab.url.includes("sdamgia.ru")) {
    console.warn("[Sdamgia PDF Cleaner] Это не сайт sdamgia.ru");
    return;
  }

  chrome.tabs.sendMessage(tab.id, { action: "cleanAndPrint" }, () => {
    if (chrome.runtime.lastError) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      }).then(() => {
        chrome.tabs.sendMessage(tab.id, { action: "cleanAndPrint" });
      }).catch((err) => {
        console.error("[Sdamgia PDF Cleaner] Ошибка внедрения скрипта:", err);
      });
    }
  });
});
