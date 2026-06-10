const id = window.PAGEDATE_CONFIG?.FORMSPREE_ID;

document.getElementById('register-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('form-msg');
  msg.className = 'msg';
  msg.textContent = '';

  if (!id || id === 'YOUR_FORM_ID') {
    msg.className = 'msg err';
    msg.textContent = 'Form not configured yet. Set FORMSPREE_ID in js/config.js';
    return;
  }

  const body = {
    name: document.getElementById('name').value,
    email: document.getElementById('email').value,
    website: document.getElementById('website').value,
    useCase: document.getElementById('useCase').value,
    _subject: 'PageDate API key request'
  };

  try {
    const res = await fetch(`https://formspree.io/f/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    msg.className = 'msg ok';
    msg.textContent = 'Request received. You will receive your API key by email after staff approval (usually 1–2 business days).';
    e.target.reset();
  } catch (err) {
    msg.className = 'msg err';
    msg.textContent = err.message;
  }
});
