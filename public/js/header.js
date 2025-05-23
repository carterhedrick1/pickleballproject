// header.js
document.addEventListener('DOMContentLoaded', function() {
    // Determine the current page for navigation highlighting
    const currentPath = window.location.pathname;
    let currentPage = 'home';
    
    if (currentPath.includes('game.html')) {
        currentPage = 'game';
    } else if (currentPath.includes('manage.html')) {
        currentPage = 'manage';
    } else if (currentPath.includes('my-games.html')) {
        currentPage = 'my-games';
    } else if (currentPath.includes('demo.html')) {
        currentPage = 'demo';
    } else if (currentPath.includes('privacy.html')) {
        currentPage = 'privacy';
    } else if (currentPath.includes('terms.html')) {
        currentPage = 'terms';
    }
    
    const headerHTML = `
        <header class="site-header">
            <div class="header-container">
                <div class="header-brand">
                    <h1>PicklePlay</h1>
                    <span class="tagline">Organize your pickleball games with ease</span>
                </div>
                
                <nav class="header-nav">
                    <a href="/" class="${currentPage === 'home' ? 'active' : ''}">Create Game</a>
                    <a href="/my-games.html" class="${currentPage === 'my-games' ? 'active' : ''}">My Games</a>
                </nav>
            </div>
        </header>
    `;
    
    // Insert header at the beginning of body
    document.body.insertAdjacentHTML('afterbegin', headerHTML);
    
    // Adjust body padding to account for header
    document.body.style.paddingTop = '0';
});