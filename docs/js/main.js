// Mobile menu toggle
const navToggle = document.getElementById('navToggle');
const navMenu = document.getElementById('navMenu');

if (navToggle && navMenu) {
  navToggle.addEventListener('click', () => {
    navMenu.classList.toggle('active');
  });
  
  // Close menu when clicking on links
  navMenu.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      navMenu.classList.remove('active');
    });
  });
}

// Update toll status
const tollStatus = document.getElementById('tollStatus');
if (tollStatus) {
  // Check if TollAI is available
  setTimeout(() => {
    if (window.TollAI && window.TOLLAI_SESSION) {
      tollStatus.innerHTML = '<span class="demo-card__dot" style="background: #3fb950;"></span> Protegido - Sesión Verificada';
    } else if (window.TollAI) {
      tollStatus.innerHTML = '<span class="demo-card__dot" style="background: #d29922;"></span> Verificando...';
    } else {
      tollStatus.innerHTML = '<span class="demo-card__dot" style="background: #f85149;"></span> TollAI No Disponible';
    }
  }, 1000);
}

// Smooth scroll offset for fixed header
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      e.preventDefault();
      const headerHeight = document.querySelector('.header').offsetHeight;
      const targetPosition = target.getBoundingClientRect().top + window.pageYOffset - headerHeight;
      window.scrollTo({
        top: targetPosition,
        behavior: 'smooth'
      });
    }
  });
});
