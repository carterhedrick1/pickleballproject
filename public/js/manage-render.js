(function attachManageRender(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ManageRender = api;
})(typeof window !== 'undefined' ? window : globalThis, function buildManageRender() {
    function element(document, tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function createPlayerItem(document, player, { meta = [], actions = [] } = {}) {
        const item = element(document, 'div', 'player-item');
        const info = element(document, 'div', 'player-info');
        const suffix = player.isOrganizer ? ' (Organizer)' : '';
        info.appendChild(element(document, 'div', 'player-name', `${player.name || ''}${suffix}`));
        if (player.phone) {
            info.appendChild(element(document, 'div', 'player-phone', player.phone));
        }
        for (const value of meta) {
            info.appendChild(element(document, 'div', 'player-phone', value));
        }
        item.appendChild(info);

        if (actions.length) {
            const actionBox = element(document, 'div', 'player-actions');
            for (const action of actions) {
                const button = element(document, 'button', action.className, action.label);
                button.type = 'button';
                button.addEventListener('click', action.onClick);
                actionBox.appendChild(button);
            }
            item.appendChild(actionBox);
        }
        return item;
    }

    function createRecipientOption(document, player, type, onChange) {
        const item = element(document, 'div', `player-checkbox-item ${type}`);
        const input = element(document, 'input', 'player-checkbox');
        input.type = 'checkbox';
        input.value = player.id;
        input.dataset.phone = player.phone;
        input.dataset.name = player.name;
        input.dataset.type = type;
        input.addEventListener('change', onChange);
        input.style.cssText =
            'width: 18px !important; height: 18px !important; margin: 0 !important; flex-shrink: 0 !important;';
        const label = element(document, 'label', '', player.name || '');
        label.style.cssText =
            'margin: 0 !important; cursor: pointer !important; flex: 1 !important; font-size: inherit !important; line-height: inherit !important;';
        item.appendChild(input);
        item.appendChild(label);
        return item;
    }

    return { createPlayerItem, createRecipientOption };
});
