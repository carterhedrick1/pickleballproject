(function () {
    const themes = {
        court: {
            name: 'Court Classic',
            colors: ['#166534', '#172033', '#F4F6F3', '#FFFFFF', '#A85D00', '#B42318']
        },
        rally: {
            name: 'Fresh Rally',
            colors: ['#0F766E', '#17202E', '#F2F7F6', '#FFFFFF', '#A15C00', '#B42318']
        },
        club: {
            name: 'Clubhouse',
            colors: ['#24513D', '#2B2925', '#F4F0E8', '#FFFDF8', '#9A6700', '#A63A2B']
        }
    };

    const colorIds = ['brandHex', 'inkHex', 'canvasHex', 'surfaceHex', 'warningHex', 'dangerHex'];
    const themeButtons = [...document.querySelectorAll('[data-theme-choice]')];
    const viewportButtons = [...document.querySelectorAll('[data-viewport]')];
    const chooseButtons = [
        document.getElementById('chooseFavorite'),
        document.getElementById('chooseFavoriteBottom')
    ];
    const favoriteSummary = document.getElementById('favoriteSummary');
    const favoriteName = document.getElementById('favoriteName');
    const favoriteMessage = document.getElementById('favoriteMessage');
    const appPreviews = document.getElementById('appPreviews');
    let activeTheme = 'court';

    function validTheme(value) {
        return Object.prototype.hasOwnProperty.call(themes, value) ? value : null;
    }

    function updateTheme(themeKey, shouldUpdateUrl) {
        const theme = themes[themeKey];
        activeTheme = themeKey;
        document.documentElement.dataset.theme = themeKey;

        themeButtons.forEach((button) => {
            const selected = button.dataset.themeChoice === themeKey;
            button.classList.toggle('is-active', selected);
            button.setAttribute('aria-pressed', String(selected));
        });

        chooseButtons.forEach((button) => {
            button.textContent = `Choose ${theme.name}`;
        });

        colorIds.forEach((id, index) => {
            document.getElementById(id).textContent = theme.colors[index];
        });

        if (shouldUpdateUrl) {
            const url = new URL(window.location.href);
            url.searchParams.set('theme', themeKey);
            window.history.replaceState({}, '', url);
        }
    }

    function saveFavorite() {
        const theme = themes[activeTheme];
        window.localStorage.setItem('inorout-design-favorite', activeTheme);
        favoriteName.textContent = theme.name;
        favoriteSummary.hidden = false;
        favoriteMessage.textContent = `${theme.name} is saved as your favorite. You can copy this page link to share your choice.`;

        const url = new URL(window.location.href);
        url.searchParams.set('theme', activeTheme);
        url.searchParams.set('favorite', activeTheme);
        window.history.replaceState({}, '', url);
    }

    themeButtons.forEach((button) => {
        button.addEventListener('click', () => updateTheme(button.dataset.themeChoice, true));
    });

    viewportButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const isMobile = button.dataset.viewport === 'mobile';
            appPreviews.classList.toggle('mobile-previews', isMobile);
            viewportButtons.forEach((item) => {
                const selected = item === button;
                item.classList.toggle('is-active', selected);
                item.setAttribute('aria-pressed', String(selected));
            });
        });
    });

    chooseButtons.forEach((button) => button.addEventListener('click', saveFavorite));

    const query = new URLSearchParams(window.location.search);
    const queryTheme = validTheme(query.get('theme'));
    const queryFavorite = validTheme(query.get('favorite'));
    const storedFavorite = validTheme(window.localStorage.getItem('inorout-design-favorite'));
    const initialTheme = queryTheme || queryFavorite || storedFavorite || 'court';
    updateTheme(initialTheme, false);

    const favorite = queryFavorite || storedFavorite;
    if (favorite) {
        favoriteName.textContent = themes[favorite].name;
        favoriteSummary.hidden = false;
    }
})();
