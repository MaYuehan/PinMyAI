/**
 * ChatPin Background Service Worker
 * Handles window management and cross-tab communication.
 */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('ChatPin Background: Message received', request);
    if (request.action === 'openNewWindow') {
        chrome.windows.create({
            url: request.url,
            focused: true,
            type: 'normal'
        }, (window) => {
            console.log('ChatPin Background: New window created', window.id);
        });
    }
});
