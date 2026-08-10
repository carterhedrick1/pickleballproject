// footer.js
document.addEventListener('DOMContentLoaded', function() {
    // Same rule as the header: paint immediately with the bundled slogan and
    // let the server rotation's pick replace it when it arrives.
    const slogan = window.InOrOutSlogans
        ? window.InOrOutSlogans.chooseLocal()
        : 'Pickleball Organizer';
    const footerHTML = `
        <footer class="site-footer">
            <div class="footer-container">
                <div class="footer-content">
                    <div class="footer-section">
                        <h4>IN or OUT</h4>
                        <p class="footer-slogan"></p>
                    </div>
                    
                    <div class="footer-section">
                        <h4>Quick Links</h4>
                        <ul>
                            <li><a href="/">How It Works</a></li>
                            <li><a href="/create.html">Create Game</a></li>
                            <li><a href="/my-games.html">My Games</a></li>
                            <li><a href="/roster.html">Roster</a></li>
                            <li><a href="/stats.html">Stats</a></li>
                        </ul>
                    </div>
                    
                    <div class="footer-section">
                        <h4>Legal</h4>
                        <ul>
                            <li><a href="/privacy.html">Privacy Policy</a></li>
                            <li><a href="/terms.html">Terms of Service</a></li>
                        </ul>
                    </div>
                    
                    <div class="footer-section">
                        <h4>Connect</h4>
                        <p>Email: <a href="mailto:support@inorout.club">support@inorout.club</a></p>
                        <p><small>Response within 48 hours</small></p>
                    </div>
                </div>
                
                <div class="footer-bottom">
                    <p>&copy; ${new Date().getFullYear()} IN or OUT. All rights reserved.</p>
                </div>
            </div>
        </footer>
    `;
    
    // Insert footer at the end of body
    document.body.insertAdjacentHTML('beforeend', footerHTML);
    document.querySelector('.footer-slogan').textContent = slogan;
    if (window.InOrOutSlogans) {
        window.InOrOutSlogans.getForPage().then(function(rotated) {
            const sloganEl = document.querySelector('.footer-slogan');
            if (sloganEl && rotated) sloganEl.textContent = rotated;
        }).catch(function() {});
    }
});
