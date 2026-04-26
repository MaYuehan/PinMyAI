/**
 * ChatPin Content Script
 * Handles DOM interactions for ChatGPT, Claude, and DeepSeek.
 */

(function() {
    'use strict';

    // --- Configuration & State ---
    const PLATFORM_CONFIG = {
        chatgpt: {
            messageSelector: '[data-testid^="conversation-turn-"]',
            contentSelector: '.markdown',
            scrollSelector: 'main .flex-1.overflow-y-auto', // ChatGPT scroll container
            getConversationId: () => {
                const path = window.location.pathname;
                const match = path.match(/\/(?:c|g|s)\/([a-zA-Z0-9-]+)/);
                return match ? match[1] : 'default';
            },
            getConversationTitle: () => {
                return document.title.replace(' - ChatGPT', '') || 'New Chat';
            }
        },
        claude: {
            messageSelector: '.font-claude-message',
            contentSelector: '.font-claude-message',
            scrollSelector: '.overflow-y-auto',
            getConversationId: () => window.location.pathname.split('/').pop(),
            getConversationTitle: () => document.title
        },
        deepseek: {
            messageSelector: '.ds-message-item',
            contentSelector: '.ds-markdown',
            scrollSelector: '.ds-scroll-container',
            getConversationId: () => window.location.pathname.split('/').pop(),
            getConversationTitle: () => document.title
        }
    };

    let currentPlatform = 'chatgpt'; // Default to ChatGPT
    let pins = [];
    let floatingBtn = null;
    let panelElement = null;
    let panelTrigger = null;

    // --- Initialization ---
    function init() {
        detectPlatform();
        setupEventListeners();
        loadPins();
        injectPanelTrigger();
    }

    function detectPlatform() {
        const host = window.location.hostname;
        if (host.includes('chatgpt.com')) currentPlatform = 'chatgpt';
        else if (host.includes('claude.ai')) currentPlatform = 'claude';
        else if (host.includes('deepseek.com')) currentPlatform = 'deepseek';
    }

    function setupEventListeners() {
        document.addEventListener('mouseup', handleMouseUp);
        document.addEventListener('mousedown', handleMouseDown);
        
        // Listen for URL changes (for SPAs)
        let lastUrl = location.href;
        new MutationObserver(() => {
            const url = location.href;
            if (url !== lastUrl) {
                lastUrl = url;
                updatePanelBadge();
            }
        }).observe(document, {subtree: true, childList: true});
    }

    // --- Selection & Floating Button ---
    function handleMouseUp(e) {
        // Delay to ensure selection is complete
        setTimeout(() => {
            const selection = window.getSelection();
            const selectedText = selection.toString().trim();

            if (selectedText && selectedText.length > 0) {
                const range = selection.getRangeAt(0);
                const rect = range.getBoundingClientRect();
                const centerX = rect.left + (rect.width / 2);
                
                showFloatingBtn(centerX, rect.top + window.scrollY, selectedText);
            } else if (floatingBtn && !e.target.closest('.chatpin-floating-btn')) {
                removeFloatingBtn();
            }
        }, 10);
    }

    function handleMouseDown(e) {
        if (floatingBtn && !e.target.closest('.chatpin-floating-btn')) {
            removeFloatingBtn();
        }
    }

    function showFloatingBtn(x, y, text) {
        removeFloatingBtn();

        floatingBtn = document.createElement('button');
        floatingBtn.className = 'chatpin-floating-btn';
        floatingBtn.innerHTML = '📌 Pin';
        
        // Adjust position to be centered above the selection
        floatingBtn.style.left = `${x}px`;
        floatingBtn.style.top = `${y}px`;
        floatingBtn.style.transform = 'translate(-50%, -100%) translateY(-10px)';

        floatingBtn.onclick = (e) => {
            e.stopPropagation();
            showNamingModal(text);
            removeFloatingBtn();
        };

        document.body.appendChild(floatingBtn);
    }

    function removeFloatingBtn() {
        if (floatingBtn) {
            floatingBtn.remove();
            floatingBtn = null;
        }
    }

    // --- Pin Creation ---
    function showNamingModal(text) {
        renderModal("Name your pin:", text.substring(0, 20) + (text.length > 20 ? '...' : ''), (name) => {
            savePin(name, text);
        });
    }

    function showRenameModal(pin) {
        renderModal("Rename pin:", pin.name, async (newName) => {
            pin.name = newName;
            await chrome.storage.local.set({ chatpins: pins });
            if (panelElement) {
                const isAll = panelElement.querySelector('.chatpin-panel-header').innerText.includes('All Pins');
                renderPanel(isAll);
            }
        });
    }

    function renderModal(title, defaultValue, onSave) {
        const overlay = document.createElement('div');
        overlay.className = 'chatpin-modal-overlay';
        
        overlay.innerHTML = `
            <div class="chatpin-modal">
                <h3>${title}</h3>
                <input type="text" id="chatpin-name-input" value="${defaultValue}">
                <div class="chatpin-modal-buttons">
                    <button class="chatpin-btn chatpin-btn-cancel" id="chatpin-cancel">Cancel</button>
                    <button class="chatpin-btn chatpin-btn-save" id="chatpin-save">Save</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const input = overlay.querySelector('#chatpin-name-input');
        input.focus();
        input.select();

        const save = () => {
            const val = input.value.trim();
            if (val) {
                onSave(val);
                overlay.remove();
            }
        };

        overlay.querySelector('#chatpin-save').onclick = save;
        overlay.querySelector('#chatpin-cancel').onclick = () => overlay.remove();
        input.onkeydown = (e) => { if (e.key === 'Enter') save(); };
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    }

    async function savePin(name, selectedText) {
        const config = PLATFORM_CONFIG[currentPlatform];
        const selection = window.getSelection();
        if (selection.rangeCount === 0) return;

        const range = selection.getRangeAt(0);
        const messageEl = range.commonAncestorContainer.nodeType === 1 
            ? range.commonAncestorContainer.closest(config.messageSelector)
            : range.commonAncestorContainer.parentElement.closest(config.messageSelector);

        const messageId = messageEl ? (messageEl.getAttribute('data-testid') || messageEl.id || 'unknown') : 'unknown';
        const scrollContainer = document.querySelector(config.scrollSelector);
        
        const pin = {
            id: Date.now().toString(),
            name,
            platform: currentPlatform,
            conversationId: config.getConversationId(),
            conversationTitle: config.getConversationTitle(),
            messageId,
            selectedText,
            scrollSelector: config.scrollSelector,
            createdAt: Date.now()
        };

        pins.push(pin);
        await chrome.storage.local.set({ chatpins: pins });
        showToast('Pin added.');
        updatePanelBadge();
        if (panelElement) renderPinList();
    }

    // --- Storage & Data ---
    async function loadPins() {
        const result = await chrome.storage.local.get('chatpins');
        pins = result.chatpins || [];
        updatePanelBadge();
    }

    function showToast(message) {
        const toast = document.createElement('div');
        toast.className = 'chatpin-toast';
        toast.innerHTML = `<span>✅</span> <span>${message}</span>`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2500);
    }

    // --- Management Panel ---
    function injectPanelTrigger() {
        if (panelTrigger) panelTrigger.remove();

        panelTrigger = document.createElement('div');
        panelTrigger.className = 'chatpin-panel-trigger';
        panelTrigger.innerHTML = '📌<span class="chatpin-badge" id="chatpin-badge">0</span>';
        panelTrigger.onclick = togglePanel;
        document.body.appendChild(panelTrigger);
        updatePanelBadge();
    }

    function updatePanelBadge() {
        const badge = document.getElementById('chatpin-badge');
        if (!badge) return;
        
        const config = PLATFORM_CONFIG[currentPlatform];
        const currentConvId = config.getConversationId();
        const currentPins = pins.filter(p => p.conversationId === currentConvId);
        
        badge.innerText = currentPins.length;
        badge.style.display = currentPins.length > 0 ? 'block' : 'none';
    }

    function togglePanel() {
        if (panelElement) {
            panelElement.remove();
            panelElement = null;
        } else {
            renderPanel();
        }
    }

    function renderPanel(showAll = false) {
        if (panelElement) panelElement.remove();

        panelElement = document.createElement('div');
        panelElement.className = 'chatpin-panel';
        
        const config = PLATFORM_CONFIG[currentPlatform];
        const currentConvId = config.getConversationId();
        
        let filteredPins = showAll ? pins : pins.filter(p => p.conversationId === currentConvId);
        
        panelElement.innerHTML = `
            <div class="chatpin-panel-header">
                <span>📌 ${showAll ? 'All Pins' : 'Pins in this chat'} (${filteredPins.length})</span>
                <span class="chatpin-panel-close">✕</span>
            </div>
            <div class="chatpin-list"></div>
            <div class="chatpin-panel-footer">
                <a class="chatpin-link" id="chatpin-toggle-view">
                    ${showAll ? 'View pins from current chat' : 'View pins from other chats'}
                </a>
            </div>
        `;

        document.body.appendChild(panelElement);

        panelElement.querySelector('.chatpin-panel-close').onclick = () => {
            panelElement.remove();
            panelElement = null;
        };

        panelElement.querySelector('#chatpin-toggle-view').onclick = () => {
            renderPanel(!showAll);
        };

        renderPinList(filteredPins);
    }

    function renderPinList(filteredPins) {
        const listContainer = panelElement.querySelector('.chatpin-list');
        listContainer.innerHTML = '';

        if (filteredPins.length === 0) {
            listContainer.innerHTML = `
                <div class="chatpin-empty">
                    <div class="chatpin-empty-icon">📌</div>
                    <div class="chatpin-empty-text">No pins yet. Select text in the chat to add one.</div>
                </div>
            `;
            return;
        }

        const isAllView = panelElement.querySelector('.chatpin-panel-header').innerText.includes('All Pins');

        if (isAllView) {
            // Group by conversation
            const groups = {};
            filteredPins.forEach(pin => {
                if (!groups[pin.conversationId]) {
                    groups[pin.conversationId] = {
                        title: pin.conversationTitle,
                        pins: []
                    };
                }
                groups[pin.conversationId].pins.push(pin);
            });

            Object.values(groups).forEach(group => {
                const groupEl = document.createElement('div');
                groupEl.innerHTML = `
                    <div style="background: var(--chatpin-item-hover); padding: 8px 20px; font-size: 0.75rem; font-weight: 700; color: var(--chatpin-text-secondary); border-bottom: 1px solid var(--chatpin-border); text-transform: uppercase; letter-spacing: 0.05em;">
                        ${group.title} (${group.pins.length})
                    </div>
                `;
                listContainer.appendChild(groupEl);

                group.pins.sort((a, b) => b.createdAt - a.createdAt).forEach(pin => {
                    listContainer.appendChild(createPinItem(pin));
                });
            });
        } else {
            filteredPins.sort((a, b) => b.createdAt - a.createdAt).forEach(pin => {
                listContainer.appendChild(createPinItem(pin));
            });
        }
    }

    function createPinItem(pin) {
        const item = document.createElement('div');
        item.className = 'chatpin-item';
        
        const date = new Date(pin.createdAt).toLocaleString();
        const currentConvId = PLATFORM_CONFIG[currentPlatform].getConversationId();
        
        item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="flex-grow: 1; overflow: hidden; text-overflow: ellipsis;">
                    <span class="chatpin-item-name">${pin.name}</span>
                    <span class="chatpin-item-time">${date}</span>
                </div>
                <div class="chatpin-item-actions">
                    <span class="chatpin-action-btn chatpin-edit" title="Rename">✏️</span>
                    <span class="chatpin-action-btn chatpin-delete" title="Delete">🗑️</span>
                </div>
            </div>
        `;

        item.onclick = (e) => {
            if (e.target.closest('.chatpin-item-actions')) return;
            jumpToPin(pin);
        };
        
        item.querySelector('.chatpin-edit').onclick = (e) => {
            e.stopPropagation();
            showRenameModal(pin);
        };

        item.querySelector('.chatpin-delete').onclick = (e) => {
            e.stopPropagation();
            if (confirm(`Delete pin "${pin.name}"?`)) {
                deletePin(pin.id);
            }
        };

        return item;
    }

    async function deletePin(id) {
        pins = pins.filter(p => p.id !== id);
        await chrome.storage.local.set({ chatpins: pins });
        updatePanelBadge();
        if (panelElement) {
            const isAll = panelElement.querySelector('.chatpin-panel-header').innerText.includes('All Pins');
            renderPanel(isAll);
        }
    }

    // --- Jump & Highlight ---
    async function jumpToPin(pin) {
        const config = PLATFORM_CONFIG[currentPlatform];
        
        // 1. Check if we need to switch conversations
        if (pin.conversationId !== config.getConversationId()) {
            if (confirm(`Switch to "${pin.conversationTitle}"? Your current conversation will be left.`)) {
                // Navigate to the other conversation
                let newUrl = '';
                if (pin.platform === 'chatgpt') newUrl = `https://chatgpt.com/c/${pin.conversationId}`;
                else if (pin.platform === 'claude') newUrl = `https://claude.ai/chat/${pin.conversationId}`;
                else if (pin.platform === 'deepseek') newUrl = `https://chat.deepseek.com/a/chat/s/${pin.conversationId}`;
                
                if (newUrl) {
                    window.location.href = newUrl;
                    // Note: We can't immediately scroll after redirect in the same script instance.
                    // The script will reload on the new page and we could check for a "jump" parameter.
                    return;
                }
            } else {
                return;
            }
        }

        // 2. Find the message element
        let targetEl = null;
        if (pin.messageId && pin.messageId !== 'unknown') {
            targetEl = document.querySelector(`[data-testid="${pin.messageId}"]`) || 
                       document.getElementById(pin.messageId);
        }

        // 3. Fallback: Search for text
        if (!targetEl) {
            const allMessages = document.querySelectorAll(config.messageSelector);
            for (const msg of allMessages) {
                if (msg.innerText.includes(pin.selectedText)) {
                    targetEl = msg;
                    break;
                }
            }
        }

        if (targetEl) {
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => highlightTextInElement(targetEl, pin.selectedText), 500);
        } else {
            // Try scrolling to trigger lazy loading
            const container = document.querySelector(config.scrollSelector);
            if (container) {
                container.scrollTo({ top: 0, behavior: 'smooth' }); // Scroll up to find older messages
                showToast('Searching for message... please wait.');
                
                // Retry after a short delay
                setTimeout(() => {
                    let retryTarget = null;
                    if (pin.messageId && pin.messageId !== 'unknown') {
                        retryTarget = document.querySelector(`[data-testid="${pin.messageId}"]`) || 
                                     document.getElementById(pin.messageId);
                    }
                    if (!retryTarget) {
                        const allMessages = document.querySelectorAll(config.messageSelector);
                        for (const msg of allMessages) {
                            if (msg.innerText.includes(pin.selectedText)) {
                                retryTarget = msg;
                                break;
                            }
                        }
                    }
                    if (retryTarget) {
                        retryTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        setTimeout(() => highlightTextInElement(retryTarget, pin.selectedText), 500);
                    } else {
                        showToast('Message not found. It might be too far up.');
                    }
                }, 1000);
            }
        }
    }

    function highlightTextInElement(element, text) {
        // Simple highlight by wrapping text in a span
        // Note: This is a destructive operation for the DOM if not careful.
        // Better: use the browser's find or a non-destructive way.
        // For MVP, we'll just flash the whole message if exact text match is hard,
        // or try to find the specific text node.

        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while (node = walker.nextNode()) {
            if (node.textContent.includes(text)) {
                const range = document.createRange();
                const start = node.textContent.indexOf(text);
                range.setStart(node, start);
                range.setEnd(node, start + text.length);
                
                const span = document.createElement('span');
                span.className = 'chatpin-highlight';
                range.surroundContents(span);
                
                setTimeout(() => {
                    // Remove the span but keep the text
                    const parent = span.parentNode;
                    while (span.firstChild) {
                        parent.insertBefore(span.firstChild, span);
                    }
                    parent.removeChild(span);
                }, 3000);
                
                return;
            }
        }

        // Fallback: flash the whole message
        element.classList.add('chatpin-highlight');
        setTimeout(() => element.classList.remove('chatpin-highlight'), 3000);
    }

    // Start
    init();

})();
