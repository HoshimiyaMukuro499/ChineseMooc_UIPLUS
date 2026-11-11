// 后台只做一件事：把内容脚本整理好的 JSON 落到本机下载目录。
// Service Worker 里没有 URL.createObjectURL，所以用 data: URL。
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'cmpy-download-json') return;

  const text = typeof msg.text === 'string' ? msg.text : '';
  if (!text) {
    sendResponse({ ok: false, error: 'empty' });
    return;
  }

  const url = 'data:application/json;charset=utf-8,' + encodeURIComponent(text);
  chrome.downloads.download(
    {
      url,
      filename: msg.filename || 'chinesemooc-pages.json',
      saveAs: false,
      conflictAction: 'overwrite',
    },
    (id) => {
      const err = chrome.runtime.lastError;
      sendResponse({ ok: !err, id, error: err ? err.message : null });
    }
  );
  return true;
});
