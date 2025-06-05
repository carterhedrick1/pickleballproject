// header.js - Updated with In or Out logo
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
 <a href="/">
 <svg viewBox="0 0 140 60" xmlns="http://www.w3.org/2000/svg">
 <defs>
 <linearGradient id="inGradient" x1="0%" y1="0%" x2="100%" y2="0%">
 <stop offset="0%" style="stop-color:#4CAF50"/>
 <stop offset="100%" style="stop-color:#45a049"/>
 </linearGradient>
 <linearGradient id="underlineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
 <stop offset="0%" style="stop-color:#4CAF50"/>
 <stop offset="70%" style="stop-color:#4CAF50;stop-opacity:0.3"/>
 <stop offset="100%" style="stop-color:#e0e0e0;stop-opacity:0.2"/>
 </linearGradient>
 </defs>
 <text x="15" y="35" font-family="Arial, sans-serif" font-size="30" font-weight="500" fill="url(#inGradient)">In</text>
 <text x="55" y="32" font-family="Arial, sans-serif" font-size="18" font-weight="300" fill="#95a5a6">or</text>
 <text x="80" y="35" font-family="Arial, sans-serif" font-size="22" font-weight="200" fill="#b8c6db" opacity="0.8">Out</text>
 <rect x="15" y="42" width="100" height="3" fill="url(#underlineGrad)" rx="1.5"/>
 <text x="15" y="55" font-family="Arial, sans-serif" font-size="11" fill="#6c757d">Pickleball Organizer</text>
 </svg>
 </a>
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