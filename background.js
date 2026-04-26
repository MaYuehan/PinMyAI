/**
 * ChatPin Background Service Worker
 * Handles window management and cross-tab communication.
 */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'openNewWindow') {
        chrome.windows.create({
            url: request.url,
            focused: true,
            type: 'normal'
        });
    }
});
