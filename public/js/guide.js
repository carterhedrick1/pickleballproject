/**
 * Guide page (index.html) - section switching and navigation
 */

function showSection(sectionId, clickedElement) {
  document.querySelectorAll('.content-section').forEach(section => {
    section.classList.remove('active');
  });
  document.querySelectorAll('.toc-item').forEach(item => {
    item.classList.remove('active');
  });
  const targetSection = document.getElementById(sectionId);
  if (targetSection) targetSection.classList.add('active');
  if (clickedElement) clickedElement.classList.add('active');
  const activeSection = document.querySelector('.content-section.active');
  if (activeSection) {
    activeSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

const sectionOrder = [
  { id: 'game-modes', label: 'Game Modes Explained' },
  { id: 'creating-games', label: 'Creating A Game' },
  { id: 'managing-players', label: 'Managing Your Game' },
  { id: 'tips-tricks', label: 'FAQs' }
];

/**
 * The hero line comes from the same rotation as the site header, but never the same line the
 * header just picked - two of these stacked on one screen reads as a glitch, not as voice.
 */
function fillHeroSlogan() {
  const hero = document.getElementById('heroSlogan');
  const slogans = window.InOrOutSlogans;
  if (!hero || !slogans) return;

  const pickOtherThan = (taken) => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const candidate = slogans.choose();
      if (candidate !== taken) return candidate;
    }
    return hero.textContent;
  };

  // Paint straight away from the bundled list; the header's pick may still be in flight.
  hero.textContent = slogans.choose();
  slogans.getForPage().then(function (headerSlogan) {
    if (headerSlogan && hero.textContent === headerSlogan) {
      hero.textContent = pickOtherThan(headerSlogan);
    }
  }).catch(function () {
    // The line already on screen is a real slogan, so there is nothing to recover from.
  });
}

document.addEventListener('DOMContentLoaded', function () {
  fillHeroSlogan();

  document.querySelectorAll('.toc-item').forEach(item => {
    item.addEventListener('click', function () {
      const sectionId = this.getAttribute('data-section');
      showSection(sectionId, this);
      this.style.transform = 'scale(0.98)';
      setTimeout(() => { this.style.transform = ''; }, 150);
    });
  });

  sectionOrder.forEach((section, idx) => {
    const sec = document.getElementById(section.id);
    if (!sec) return;
    const navDiv = document.createElement('div');
    navDiv.className = 'section-nav-buttons';
    const prevIdx = (idx === 0) ? sectionOrder.length - 1 : idx - 1;
    const prevBtn = document.createElement('button');
    prevBtn.className = 'section-nav-btn prev';
    prevBtn.innerHTML = `← Previous: ${sectionOrder[prevIdx].label}`;
    prevBtn.setAttribute('data-section', sectionOrder[prevIdx].id);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'section-nav-btn close';
    closeBtn.innerHTML = 'Close';
    closeBtn.setAttribute('type', 'button');
    const nextIdx = (idx === sectionOrder.length - 1) ? 0 : idx + 1;
    const nextBtn = document.createElement('button');
    nextBtn.className = 'section-nav-btn next';
    nextBtn.innerHTML = `Next: ${sectionOrder[nextIdx].label} →`;
    nextBtn.setAttribute('data-section', sectionOrder[nextIdx].id);
    if (window.innerWidth <= 600) {
      navDiv.appendChild(closeBtn);
      navDiv.appendChild(prevBtn);
      navDiv.appendChild(nextBtn);
    } else {
      navDiv.appendChild(prevBtn);
      navDiv.appendChild(closeBtn);
      navDiv.appendChild(nextBtn);
    }
    sec.appendChild(navDiv);
  });

  document.body.addEventListener('click', function (e) {
    if (!e.target.classList.contains('section-nav-btn')) return;
    if (e.target.classList.contains('close')) {
      document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
      document.querySelectorAll('.toc-item').forEach(item => item.classList.remove('active'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const sectionId = e.target.getAttribute('data-section');
    const tocItem = document.querySelector(`.toc-item[data-section='${sectionId}']`);
    showSection(sectionId, tocItem || null);
  });
});
