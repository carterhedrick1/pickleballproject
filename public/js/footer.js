// footer.js
document.addEventListener('DOMContentLoaded', function() {
    const footerHTML = `
        <footer class="site-footer">
            <div class="footer-container">
                <div class="footer-content">
                    <div class="footer-section">
                        <h4>In or Out</h4>
                        <p>Making pickleball game organization simple and fun. Connect with players, organize games, and never miss a match.</p>
                    </div>
                    
                    <div class="footer-section">
                        <h4>Quick Links</h4>
                        <ul>
                            <li><a href="/">Create Game</a></li>
                            <li><a href="/demo.html">How It Works</a></li>
                            <li><a href="#support">Support</a></li>
                        </ul>
                    </div>
                    
                    <div class="footer-section">
                        <h4>Legal</h4>
                        <ul>
                            <li><a href="/privacy.html">Privacy Policy</a></li>
                            <li><a href="/terms.html">Terms of Service</a></li>
                            <li><a href="#contact">Contact Us</a></li>
                        </ul>
                    </div>
                    
                    <div class="footer-section">
                        <h4>Connect</h4>
                        <p>Questions? Feedback?</p>
                        <p>Email: <a href="mailto:support@inorout.club">support@inorout.club</a></p>
                        <p><small>Response within 24 hours</small></p>
                    </div>
                </div>
                
                <div class="footer-bottom">
                    <p>&copy; 2025 In or Out. All rights reserved.</p>
                </div>
            </div>
        </footer>
    `;
    
    // Insert footer at the end of body
    document.body.insertAdjacentHTML('beforeend', footerHTML);
});