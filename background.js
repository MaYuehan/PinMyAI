/**
 * ChatPin Background Service Worker
 * Handles window management and cross-tab communication.
 */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('ChatPin Background: Message received', request);
    if (request.action === 'openNewTab') {
        chrome.tabs.create({
            url: request.url,
            active: true
        }, (tab) => {
            console.log('ChatPin Background: New tab created', tab.id);
        });
    }
});
