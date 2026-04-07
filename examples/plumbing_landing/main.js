'use strict';

// Mobile nav toggle
const burger = document.querySelector('.nav__burger');
const navLinks = document.querySelector('.nav__links');

burger?.addEventListener('click', () => {
  const open = navLinks.classList.toggle('open');
  burger.setAttribute('aria-expanded', String(open));
});

// Close mobile nav when a link is clicked
navLinks?.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    navLinks.classList.remove('open');
    burger?.setAttribute('aria-expanded', 'false');
  });
});

// Sticky nav shadow on scroll
const nav = document.querySelector('.nav');
window.addEventListener('scroll', () => {
  nav?.classList.toggle('nav--scrolled', window.scrollY > 8);
}, { passive: true });

// Contact form — simple client-side validation + success feedback
const form = document.querySelector('.contact__form');

form?.addEventListener('submit', (e) => {
  e.preventDefault();

  const name  = form.querySelector('#name').value.trim();
  const phone = form.querySelector('#phone').value.trim();

  if (!name || !phone) {
    alert('Please enter your name and phone number.');
    return;
  }

  const btn = form.querySelector('button[type="submit"]');
  btn.textContent = 'Sent! We\'ll call you shortly.';
  btn.disabled = true;
  btn.style.background = '#16a34a';
  btn.style.borderColor = '#16a34a';

  form.querySelectorAll('input, select, textarea').forEach(el => {
    el.disabled = true;
  });
});
