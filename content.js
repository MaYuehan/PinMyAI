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
    let currentSortMode = 'time_new'; // 'time_new', 'time_old', 'chat_order'

    async function init() {
        detectPlatform();
        setupEventListeners();
        await loadPins();
        injectPanelTrigger();
        
        // Check for auto-jump parameter on load
        checkAutoJump();
    }

    function checkAutoJump() {
        const urlParams = new URLSearchParams(window.location.search);
        const jumpId = urlParams.get('chatpin_jump');
        if (jumpId) {
            // Wait for messages to load, then jump
            const checkInterval = setInterval(() => {
                const pin = pins.find(p => p.id === jumpId);
                if (pin) {
                    const config = PLATFORM_CONFIG[currentPlatform];
                    const targetEl = pin.messageId && pin.messageId !== 'unknown' 
                        ? (document.querySelector(`[data-testid="${pin.messageId}"]`) || document.getElementById(pin.messageId))
                        : Array.from(document.querySelectorAll(config.messageSelector)).find(msg => msg.innerText.includes(pin.selectedText));
                    
                    if (targetEl) {
                        clearInterval(checkInterval);
                        setTimeout(() => jumpToPin(pin), 1000); // Small delay for layout stability
                    }
                }
            }, 500);
            
            // Timeout after 10 seconds
            setTimeout(() => clearInterval(checkInterval), 10000);
        }
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
                // If panel is open, refresh it for the new conversation
                if (panelElement) renderPanel(false);
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
                
                // Calculate horizontal center of selection
                const centerX = rect.left + (rect.width / 2);
                
                // Position button centered horizontally below the selection
                showFloatingBtn(centerX, rect.bottom + window.scrollY, selectedText);
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
        
        // Position centered horizontally below selection
        floatingBtn.style.left = `${x}px`;
        floatingBtn.style.top = `${y}px`;
        floatingBtn.style.transform = 'translateX(-50%) translateY(8px)';

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
            showToast('Pin renamed.');
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
        
        // Calculate message order
        let messageOrder = 0;
        if (messageEl) {
            const allMessages = Array.from(document.querySelectorAll(config.messageSelector));
            messageOrder = allMessages.indexOf(messageEl);
        }

        const pin = {
            id: Date.now().toString(),
            name,
            platform: currentPlatform,
            conversationId: config.getConversationId(),
            conversationTitle: config.getConversationTitle(),
            messageId,
            messageOrder,
            selectedText,
            scrollSelector: config.scrollSelector,
            createdAt: Date.now()
        };

        pins.push(pin);
        await chrome.storage.local.set({ chatpins: pins });
        showToast('Pin added.');
        if (panelElement) {
            const isAll = panelElement.querySelector('.chatpin-panel-header').innerText.includes('All Pins');
            renderPanel(isAll);
        }
    }

    // --- Storage & Data ---
    async function loadPins() {
        try {
            const result = await chrome.storage.local.get(['chatpins', 'sortMode']);
            pins = Array.isArray(result.chatpins) ? result.chatpins : [];
            currentSortMode = result.sortMode || 'time_new';
        } catch (e) {
            console.error('ChatPin: Failed to load pins', e);
            pins = [];
        }
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
        panelTrigger.innerHTML = '📌';
        panelTrigger.onclick = togglePanel;
        document.body.appendChild(panelTrigger);
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
        
        // Ensure pins is an array
        if (!Array.isArray(pins)) pins = [];
        
        let filteredPins = showAll ? pins : pins.filter(p => p && p.conversationId === currentConvId);
        
        const sortLabels = {
            'time_new': 'Time (Newest)',
            'time_old': 'Time (Oldest)',
            'chat_order': 'Chat Order'
        };

        panelElement.innerHTML = `
            <div class="chatpin-panel-header">
                <span>📌 ${showAll ? 'All Pins' : 'Pins'}</span>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div class="chatpin-sort-container">
                        <button class="chatpin-sort-trigger" id="chatpin-sort-btn">${sortLabels[currentSortMode]} ▾</button>
                        <div class="chatpin-sort-menu" id="chatpin-sort-menu">
                            <div class="chatpin-sort-option" data-sort="time_new">Time (Newest)</div>
                            <div class="chatpin-sort-option" data-sort="time_old">Time (Oldest)</div>
                            <div class="chatpin-sort-option" data-sort="chat_order">Chat Order</div>
                        </div>
                    </div>
                    <span class="chatpin-panel-close">✕</span>
                </div>
            </div>
            <div class="chatpin-list"></div>
            <div class="chatpin-panel-footer">
                <a class="chatpin-link" id="chatpin-toggle-view">
                    ${showAll ? 'View pins from current chat' : 'View pins from other chats'}
                </a>
            </div>
        `;

        document.body.appendChild(panelElement);

        // Sort events
        const sortBtn = panelElement.querySelector('#chatpin-sort-btn');
        const sortMenu = panelElement.querySelector('#chatpin-sort-menu');
        
        sortBtn.onclick = (e) => {
            e.stopPropagation();
            sortMenu.classList.toggle('active');
        };

        panelElement.querySelectorAll('.chatpin-sort-option').forEach(opt => {
            opt.onclick = async (e) => {
                currentSortMode = e.target.dataset.sort;
                await chrome.storage.local.set({ sortMode: currentSortMode });
                sortMenu.classList.remove('active');
                renderPanel(showAll);
            };
        });

        // Close sort menu on click outside
        document.addEventListener('click', (e) => {
            if (sortMenu && !sortMenu.contains(e.target) && e.target !== sortBtn) {
                sortMenu.classList.remove('active');
            }
        }, { once: true });

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
        if (!panelElement) return;
        const listContainer = panelElement.querySelector('.chatpin-list');
        if (!listContainer) return;
        
        listContainer.innerHTML = '';

        if (!filteredPins || filteredPins.length === 0) {
            listContainer.innerHTML = `
                <div class="chatpin-empty">
                    <div class="chatpin-empty-icon">📌</div>
                    <div class="chatpin-empty-text">No pins yet — select any text and click the pin button to get started.</div>
                </div>
            `;
            return;
        }

        const isAllView = panelElement.querySelector('.chatpin-panel-header').innerText.includes('All Pins');

        // Apply Sorting
        const sortedPins = [...filteredPins];
        if (currentSortMode === 'time_new') {
            sortedPins.sort((a, b) => b.createdAt - a.createdAt);
        } else if (currentSortMode === 'time_old') {
            sortedPins.sort((a, b) => a.createdAt - b.createdAt);
        } else if (currentSortMode === 'chat_order') {
            sortedPins.sort((a, b) => {
                // First by conversation, then by order
                if (a.conversationId !== b.conversationId) {
                    return b.createdAt - a.createdAt; // Different convs: newest first
                }
                return (a.messageOrder || 0) - (b.messageOrder || 0);
            });
        }

        if (isAllView) {
            // Group by conversation
            const groups = {};
            sortedPins.forEach(pin => {
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
                    <div style="background: var(--chatpin-bg-subtle); padding: 8px 20px; font-size: 11px; font-weight: 600; color: var(--chatpin-text-secondary); border-bottom: 1px solid var(--chatpin-border); text-transform: uppercase; letter-spacing: 0.03em;">
                        ${group.title} (${group.pins.length})
                    </div>
                `;
                listContainer.appendChild(groupEl);

                group.pins.forEach(pin => {
                    listContainer.appendChild(createPinItem(pin));
                });
            });
        } else {
            sortedPins.forEach(pin => {
                listContainer.appendChild(createPinItem(pin));
            });
        }
    }

    function createPinItem(pin) {
        const item = document.createElement('div');
        item.className = 'chatpin-item';
        
        const date = new Date(pin.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        
        item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                <div style="flex-grow: 1; overflow: hidden; text-overflow: ellipsis; padding-right: 12px;">
                    <span class="chatpin-item-name">${pin.name}</span>
                    <span class="chatpin-item-time">${date}</span>
                    ${pin.conversationId !== PLATFORM_CONFIG[currentPlatform].getConversationId() ? `<div style="font-size:11px; color:var(--chatpin-text-secondary); margin-top:2px; opacity: 0.8;">${pin.conversationTitle}</div>` : ''}
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
            // Build conversation URL based on platform
            let newUrl = '';
            if (pin.platform === 'chatgpt') newUrl = `https://chatgpt.com/c/${pin.conversationId}`;
            else if (pin.platform === 'claude') newUrl = `https://claude.ai/chat/${pin.conversationId}`;
            else if (pin.platform === 'deepseek') newUrl = `https://chat.deepseek.com/a/chat/s/${pin.conversationId}`;
            
            if (newUrl) {
                // Add jump parameter to URL
                const jumpUrl = new URL(newUrl);
                jumpUrl.searchParams.set('chatpin_jump', pin.id);
                
                // Open in new window/tab
                window.open(jumpUrl.toString(), '_blank');
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
