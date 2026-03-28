// extension-client/content.js
(function () {
  'use strict';
  let detected = false, injected = false;

  function getSitekey() {
    const el = document.querySelector('[data-sitekey]');
    if (el) return el.getAttribute('data-sitekey');
    for (const f of document.querySelectorAll('iframe[src*="hcaptcha.com"]')) {
      try { const sk = new URL(f.src).searchParams.get('sitekey'); if (sk) return sk; } catch (_) {}
    }
    return null;
  }

  function hasHCaptcha() {
    return !!(
      document.querySelector('.h-captcha, [data-sitekey], [data-hcaptcha-widget-id]') ||
      document.querySelector('iframe[src*="hcaptcha.com"]') ||
      document.querySelector('script[src*="hcaptcha.com"]')
    );
  }

  function scan() {
    if (detected) return;
    if (!hasHCaptcha()) return;
    const sitekey = getSitekey();
    if (!sitekey) return;
    detected = true;
    observer.disconnect();
    chrome.runtime.sendMessage({ type: 'CAPTCHA_FOUND', sitekey, url: location.href }, res => {
      if (chrome.runtime.lastError || !res?.ok) detected = false;
    });
  }

  const observer = new MutationObserver(() => { if (!detected) scan(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scan();

  chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
    if (msg.type === 'INJECT' && !injected) {
      injected = true;
      injectToken(msg.token);
      sendResponse({ ok: true });
    }
    return true;
  });

  function injectToken(token) {
    const selectors = [
      'textarea[name="h-captcha-response"]',
      'textarea[name="g-recaptcha-response"]',
      'input[name="h-captcha-response"]'
    ];
    let done = false;
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        const proto  = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        setter ? setter.call(el, token) : (el.value = token);
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        done = true;
      });
    });
    if (!done) return;
    setTimeout(() => {
      const form   = document.querySelector('form');
      const submit = form?.querySelector('button[type="submit"]:not([disabled]),input[type="submit"]:not([disabled])');
      if (submit) submit.click();
      else if (form) { const ev = new Event('submit',{bubbles:true,cancelable:true}); if(form.dispatchEvent(ev)) form.submit(); }
    }, 500);
  }
})();
