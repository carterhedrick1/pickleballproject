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

    /** (816) 555-0102 instead of 8165550102. Anything that is not a plain 10- or
     *  11-digit US number passes through untouched. */
    function prettyPhone(value) {
        const digits = String(value == null ? '' : value).replace(/\D/g, '');
        const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
        if (local.length !== 10) return value;
        return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
    }

    /** A short coloured word - IN, OUT, No Reply - that carries the row's state at a glance. */
    function createStatusChip(document, badge) {
        return element(
            document,
            'span',
            `status-chip status-chip--${badge.tone || 'muted'}`,
            badge.label
        );
    }

    function createPlayerItem(document, player, { meta = [], actions = [], badge = null } = {}) {
        const item = element(document, 'div', 'player-item');
        const info = element(document, 'div', 'player-info');
        const suffix = player.isOrganizer ? ' (Organizer)' : '';
        info.appendChild(element(document, 'div', 'player-name', `${player.name || ''}${suffix}`));
        if (player.phone) {
            info.appendChild(element(document, 'div', 'player-phone', prettyPhone(player.phone)));
        }
        for (const value of meta) {
            info.appendChild(element(document, 'div', 'player-phone', value));
        }
        item.appendChild(info);

        if (badge) item.appendChild(createStatusChip(document, badge));

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

    function createRosterOption(document, player, onChange, { badge = null, meta = [] } = {}) {
        const option = element(document, 'label', 'roster-player-option');
        const input = element(document, 'input', 'roster-player-checkbox');
        input.type = 'checkbox';
        input.value = player.phone || '';
        input.dataset.phone = player.phone || '';
        input.addEventListener('change', onChange);

        const details = element(document, 'span', 'roster-player-details');
        details.appendChild(
            element(document, 'span', 'roster-player-name', player.name || player.phone || '')
        );

        const metadata = [prettyPhone(player.phone || '')];
        metadata.push(...meta);
        details.appendChild(
            element(document, 'span', 'roster-player-meta', metadata.filter(Boolean).join(' · '))
        );

        option.appendChild(input);
        option.appendChild(details);
        if (badge) option.appendChild(createStatusChip(document, badge));
        return option;
    }

    return { createPlayerItem, createRecipientOption, createRosterOption, createStatusChip, prettyPhone };
});
