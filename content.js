/**
 * ChatPin Content Script
 * Handles DOM interactions for ChatGPT, Claude, and DeepSeek.
 */

(function() {
    'use strict';

    // --- Configuration & State ---
    const PLATFORM_CONFIG = {
        chatgpt: {
            messageSelector: '[data-testid^="conversation-turn-"], .group',
            contentSelector: '.markdown, .flex-col.gap-1',
            scrollSelector: 'main .flex-1.overflow-y-auto, [class*="react-scroll"]',
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
            messageSelector: '[data-testid="chat-message"], .font-claude-message, .chat-message',
            contentSelector: '.grid-cols-1, .font-claude-message',
            scrollSelector: '[data-testid="scroll-container"], .overflow-y-auto, main',
            getConversationId: () => window.location.pathname.split('/').pop(),
            getConversationTitle: () => document.title
        },
        deepseek: {
            messageSelector: '.ds-message-item, [data-message-id]',
            contentSelector: '.ds-markdown, .ds-message-content',
            scrollSelector: '.ds-scroll-container, [class*="scroll"], main',
            getConversationId: () => {
                const path = window.location.pathname;
                const match = path.match(/\/chat\/s\/([a-zA-Z0-9-]+)/) || path.match(/\/a\/chat\/s\/([a-zA-Z0-9-]+)/);
                return match ? match[1] : window.location.pathname.split('/').pop();
            },
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
        if (!jumpId) return;

        // Clean URL without reloading
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('chatpin_jump');
        history.replaceState(null, '', cleanUrl.toString());

        // Wait up to 10 seconds for both pins to load and message to appear
        let attempts = 0;
        const checkInterval = setInterval(() => {
            attempts++;
            const pin = pins.find(p => p.id === jumpId);
            if (!pin) {
                if (attempts >= 20) {
                    clearInterval(checkInterval);
                    showToast('❌ Pin not found.');
                }
                return;
            }

            const targetEl = findPinElement(pin);
            if (targetEl) {
                clearInterval(checkInterval);
                // Extra delay for page render to settle
                setTimeout(() => doScrollAndHighlight(targetEl, pin.selectedText), 800);
            } else if (attempts >= 20) {
                clearInterval(checkInterval);
                showToast('❌ Message not found in this conversation.');
            }
        }, 500);
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
        
        // Listen for URL changes (for SPAs like ChatGPT / Claude)
        // We strip the search params before comparing so that our own
        // history.replaceState (removing ?chatpin_jump) doesn't count as a navigation.
        let lastPath = location.pathname;
        new MutationObserver(() => {
            const path = location.pathname;
            if (path !== lastPath) {
                lastPath = path;
                // Only refresh if the panel is actually open
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
        // IMPORTANT: Capture the message element NOW, while the selection still exists.
        // By the time the user clicks Save in the modal, window.getSelection() will be empty.
        const config = PLATFORM_CONFIG[currentPlatform];
        const selection = window.getSelection();

        let messageId = 'unknown';
        let messageOrder = 0;

        if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const messageEl = range.commonAncestorContainer.nodeType === 1
                ? range.commonAncestorContainer.closest(config.messageSelector)
                : range.commonAncestorContainer.parentElement?.closest(config.messageSelector);

            if (messageEl) {
                messageId = messageEl.getAttribute('data-testid') || messageEl.id || 'unknown';
                const allMessages = Array.from(document.querySelectorAll(config.messageSelector));
                messageOrder = allMessages.indexOf(messageEl);
            }
        }

        renderModal("Name your pin:", text.substring(0, 20) + (text.length > 20 ? '...' : ''), (name) => {
            savePin(name, text, messageId, messageOrder);
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

    async function savePin(name, selectedText, messageId, messageOrder) {
        const config = PLATFORM_CONFIG[currentPlatform];

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
        console.log('ChatPin: Toast', message);
        const toast = document.createElement('div');
        toast.className = 'chatpin-toast';
        // Only prepend ✅ if message doesn't already start with an emoji indicator
        const hasEmoji = /^[\u{1F300}-\u{1FFFF}❌✅🔍⚠️]/u.test(message);
        toast.innerHTML = hasEmoji
            ? `<span>${message}</span>`
            : `<span>✅</span> <span>${message}</span>`;
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

        // Add event delegation to listContainer
        listContainer.onclick = (e) => {
            const item = e.target.closest('.chatpin-item');
            if (!item) return;
            
            // If click was on an action button, don't jump
            if (e.target.closest('.chatpin-item-actions')) return;
            
            const pinId = item.dataset.pinId;
            const pin = pins.find(p => p.id === pinId);
            if (pin) {
                jumpToPin(pin);
            }
        };

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
        item.dataset.pinId = pin.id;
        
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

    function showJumpDialog(pin) {
        const overlay = document.createElement('div');
        overlay.className = 'chatpin-modal-overlay';
        
        let convUrl = '';
        if (pin.platform === 'chatgpt') convUrl = `https://chatgpt.com/c/${pin.conversationId}`;
        else if (pin.platform === 'claude') convUrl = `https://claude.ai/chat/${pin.conversationId}`;
        else if (pin.platform === 'deepseek') convUrl = `https://chat.deepseek.com/a/chat/s/${pin.conversationId}`;
        
        if (!convUrl) {
            showToast('❌ Invalid conversation URL');
            return;
        }

        const jumpUrl = new URL(convUrl);
        jumpUrl.searchParams.set('chatpin_jump', pin.id);
        const finalUrl = jumpUrl.toString();

        overlay.innerHTML = `
            <div class="chatpin-jump-dialog">
                <span class="chatpin-close-x">✕</span>
                <h3>Switch Conversation?</h3>
                <p>This pin is in "<strong>${pin.conversationTitle}</strong>". How would you like to jump?</p>
                <div class="chatpin-jump-options">
                    <button class="chatpin-jump-btn chatpin-jump-btn-primary" id="chatpin-jump-new-window">Open in New Window</button>
                    <button class="chatpin-jump-btn" id="chatpin-jump-current">Jump in Current Window</button>
                    <button class="chatpin-jump-btn" id="chatpin-jump-cancel">Cancel</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const close = () => overlay.remove();

        overlay.querySelector('.chatpin-close-x').onclick = close;
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
        overlay.querySelector('#chatpin-jump-cancel').onclick = close;

        overlay.querySelector('#chatpin-jump-new-window').onclick = () => {
            chrome.runtime.sendMessage({ action: 'openNewWindow', url: finalUrl });
            close();
        };

        overlay.querySelector('#chatpin-jump-current').onclick = () => {
            window.location.href = finalUrl;
            close();
        };
    }

    // --- Jump & Highlight ---

    /**
     * Find the message element containing the pin's selected text.
     * Returns { messageEl, anchorEl } where anchorEl is a temporary <span>
     * inserted at the exact text location for precise scrolling.
     * Caller MUST remove anchorEl after use.
     */
    function findPinAnchor(pin) {
        const config = PLATFORM_CONFIG[currentPlatform];

        // Find the message element (same 3-strategy logic as before)
        let messageEl = null;

        if (pin.messageId && pin.messageId !== 'unknown') {
            messageEl = document.querySelector(`[data-testid="${pin.messageId}"]`) ||
                        document.getElementById(pin.messageId);
        }

        if (!messageEl) {
            const allMessages = Array.from(document.querySelectorAll(config.messageSelector));
            if (pin.messageOrder !== undefined && allMessages[pin.messageOrder]) {
                const msg = allMessages[pin.messageOrder];
                if (msg.innerText.includes(pin.selectedText)) messageEl = msg;
            }
            if (!messageEl) {
                for (const msg of allMessages) {
                    if (msg.innerText.includes(pin.selectedText)) { messageEl = msg; break; }
                }
            }
        }

        if (!messageEl) return null;

        // Walk text nodes to find the exact location of selectedText
        const walker = document.createTreeWalker(messageEl, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while (node = walker.nextNode()) {
            const idx = node.textContent.indexOf(pin.selectedText);
            if (idx !== -1) {
                // Insert a zero-height anchor span right before the matched text
                const range = document.createRange();
                range.setStart(node, idx);
                range.setEnd(node, idx); // zero-width, non-destructive
                const anchor = document.createElement('span');
                anchor.style.cssText = 'display:inline;pointer-events:none;';
                range.insertNode(anchor);
                return { messageEl, anchor };
            }
        }

        // Fallback: couldn't find the exact text node, scroll to message top
        return { messageEl, anchor: null };
    }

    // findPinElement is used by the lazy-load retry path — just needs the messageEl, no anchor
    function findPinElement(pin) {
        const config = PLATFORM_CONFIG[currentPlatform];

        if (pin.messageId && pin.messageId !== 'unknown') {
            const el = document.querySelector(`[data-testid="${pin.messageId}"]`) ||
                       document.getElementById(pin.messageId);
            if (el) return el;
        }

        const allMessages = Array.from(document.querySelectorAll(config.messageSelector));
        if (pin.messageOrder !== undefined && allMessages[pin.messageOrder]) {
            const msg = allMessages[pin.messageOrder];
            if (msg.innerText.includes(pin.selectedText)) return msg;
        }
        for (const msg of allMessages) {
            if (msg.innerText.includes(pin.selectedText)) return msg;
        }
        return null;
    }

    /**
     * Find the best scroll container for the current platform.
     */
    function getScrollContainer(targetEl = null) {
        const config = PLATFORM_CONFIG[currentPlatform];
        console.log('ChatPin: Finding scroll container for', currentPlatform);

        // 1. If we have a target element, find its nearest scrollable parent
        if (targetEl) {
            let parent = targetEl.parentElement;
            while (parent && parent !== document.body) {
                const style = window.getComputedStyle(parent);
                const isScrollable = /(auto|scroll)/.test(style.overflowY + style.overflow);
                if (isScrollable && parent.scrollHeight > parent.clientHeight) {
                    console.log('ChatPin: Found container via parent hierarchy');
                    return parent;
                }
                parent = parent.parentElement;
            }
        }

        // 2. Try platform-specific selector first
        const platformScroll = document.querySelector(config.scrollSelector);
        if (platformScroll && platformScroll.scrollHeight > platformScroll.clientHeight) {
            console.log('ChatPin: Found container via selector', config.scrollSelector);
            return platformScroll;
        }

        // 3. Fallback: Find the scrollable element that actually contains message elements.
        const allScrollable = Array.from(document.querySelectorAll('*')).filter(el => {
            const style = getComputedStyle(el);
            return (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
                   el.scrollHeight > el.clientHeight &&
                   el.clientHeight > 200; // ignore tiny scrollable areas
        });

        console.log(`ChatPin: Found ${allScrollable.length} scrollable candidates`);

        // Prefer the one that contains a message element
        for (let i = allScrollable.length - 1; i >= 0; i--) {
            if (allScrollable[i].querySelector(config.messageSelector)) {
                console.log('ChatPin: Found container via message child check');
                return allScrollable[i];
            }
        }
        
        // 4. Final Fallback: largest scrollable area or main/body
        const largest = allScrollable.sort((a, b) => b.clientHeight - a.clientHeight)[0];
        console.log('ChatPin: Falling back to largest or body');
        return largest || document.querySelector('main') || document.body;
    }

    /**
     * Scroll precisely to the pin's location, then highlight it.
     */
    function doScrollAndHighlight(targetEl, selectedText) {
        console.log('ChatPin: Preparing scroll to', targetEl);
        const container = getScrollContainer(targetEl);
        if (!container) {
            console.warn('ChatPin: No scroll container found, using window');
        }

        // Try to get a precise anchor at the exact text position
        const walker = document.createTreeWalker(targetEl, NodeFilter.SHOW_TEXT, null, false);
        let anchor = null;
        let node;
        while (node = walker.nextNode()) {
            const idx = node.textContent.indexOf(selectedText);
            if (idx !== -1) {
                const range = document.createRange();
                range.setStart(node, idx);
                range.setEnd(node, idx);
                anchor = document.createElement('span');
                anchor.style.cssText = 'display:inline-block;width:0;height:0;pointer-events:none;';
                try {
                    range.insertNode(anchor);
                    console.log('ChatPin: Inserted precise scroll anchor');
                } catch (e) {
                    console.warn('ChatPin: Failed to insert anchor', e);
                    anchor = null;
                }
                break;
            }
        }

        const scrollTarget = anchor || targetEl;
        scrollToTargetWithOffset(scrollTarget, container);

        // After scroll settles: remove anchor, then highlight
        setTimeout(() => {
            if (anchor && anchor.parentNode) {
                const parent = anchor.parentNode;
                parent.removeChild(anchor);
                parent.normalize();
            }
            highlightTextInElement(targetEl, selectedText);
        }, 1200);
    }

    async function jumpToPin(pin) {
        console.log('ChatPin: Jumping to pin', pin);
        const config = PLATFORM_CONFIG[currentPlatform];

        // 1. Different conversation → show dialog
        if (pin.conversationId !== config.getConversationId()) {
            console.log('ChatPin: Cross-conversation jump detected');
            showJumpDialog(pin);
            return;
        }

        // 2. Same conversation → try to find element immediately
        let targetEl = findPinElement(pin);
        if (targetEl) {
            console.log('ChatPin: Target element found immediately');
            doScrollAndHighlight(targetEl, pin.selectedText);
            return;
        }

        // 3. Not found — element is outside the virtual scroll viewport.
        console.log('ChatPin: Target not in DOM, attempting lazy-load search');
        showToast('🔍 Searching for message…');

        const container = getScrollContainer();
        if (!container) {
            showToast('❌ Scroll container not found.');
            return;
        }

        const totalHeight = container.scrollHeight;
        const totalMessages = document.querySelectorAll(config.messageSelector).length;

        // Estimate where the target message is based on messageOrder ratio
        // and jump the scroll position there to trigger virtual scroll rendering.
        const estimatedRatio = totalMessages > 0
            ? (pin.messageOrder || 0) / Math.max(totalMessages, 1)
            : 0;
        const estimatedScrollTop = totalHeight * estimatedRatio;

        container.scrollTo({ top: estimatedScrollTop, behavior: 'smooth' });

        // Retry up to 8 times over 4 seconds (every 500ms)
        let attempts = 0;
        const retryInterval = setInterval(() => {
            attempts++;
            targetEl = findPinElement(pin);

            if (targetEl) {
                clearInterval(retryInterval);
                doScrollAndHighlight(targetEl, pin.selectedText);
            } else if (attempts >= 8) {
                clearInterval(retryInterval);
                showToast('❌ Message not found. It may have been deleted or too far up.');
            } else {
                // Keep nudging the scroll position to trigger more DOM rendering
                const nudge = estimatedScrollTop + (attempts % 2 === 0 ? -200 : 200) * attempts;
                container.scrollTo({ top: Math.max(0, nudge), behavior: 'smooth' });
            }
        }, 500);
    }

    function highlightTextInElement(element, text) {
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

                try {
                    // surroundContents throws if the range crosses element boundaries
                    range.surroundContents(span);
                } catch (e) {
                    // Cross-element selection: fall back to flashing the whole message
                    element.classList.add('chatpin-highlight');
                    setTimeout(() => element.classList.remove('chatpin-highlight'), 3000);
                    return;
                }

                setTimeout(() => {
                    const parent = span.parentNode;
                    if (parent) {
                        while (span.firstChild) {
                            parent.insertBefore(span.firstChild, span);
                        }
                        parent.removeChild(span);
                        // Normalize to merge split text nodes — prevents duplicate content bug
                        // in React-based chats (ChatGPT, Claude).
                        parent.normalize();
                    }
                }, 3000);

                return;
            }
        }

        // Fallback: no matching text node found — flash the whole message
        element.classList.add('chatpin-highlight');
        setTimeout(() => element.classList.remove('chatpin-highlight'), 3000);
    }

    function scrollToTargetWithOffset(targetEl, scrollContainer) {
        if (!targetEl) return;

        const container = scrollContainer;
        const isValidContainer = container &&
            container !== window &&
            container.clientHeight > 0 &&
            container.scrollHeight > container.clientHeight;

        // Step 1: Smooth scroll the element into view at the top.
        // scrollIntoView is the only reliable way to reach elements regardless
        // of whether they are near or far from the current scroll position.
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

        // Step 2: After scrollIntoView settles (~800ms), nudge down to 1/3 position.
        // At this point rect.top ≈ 0 (element is at top of viewport), so we
        // scroll DOWN by viewportHeight/3 to land it at the 1/3 mark.
        setTimeout(() => {
            const viewportHeight = isValidContainer ? container.clientHeight : window.innerHeight;
            const offset = viewportHeight / 3;
            if (isValidContainer) {
                container.scrollBy({ top: -offset, behavior: 'smooth' });
            } else {
                window.scrollBy({ top: -offset, behavior: 'smooth' });
            }
        }, 800);
    }

    // Start
    init();

})();