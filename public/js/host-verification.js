// The "text me a code" gate in front of the pages that show a host their own history:
// My Games, Roster and Stats.
//
// init() draws and drives the whole gate; authHeaders() is the other half of it, and the manage
// page imports that alone - adding somebody to a saved roster needs the verified phone session,
// but the manage page is reached by a link with a game token and never shows this gate.
const PHONE_KEY = 'hostPhone';
const TOKEN_KEY = 'hostVerificationToken';

let config;
let pendingPhone = '';

const byId = (id) => document.getElementById(id);

function digitsOnly(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function prettyPhone(phone) {
    return phone && phone.length === 10
        ? `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`
        : phone;
}

function showPhoneStep() {
    byId('phoneGate').style.display = 'block';
    byId('phoneStep').style.display = 'block';
    byId('codeStep').style.display = 'none';
    if (config.contentId) byId(config.contentId).style.display = 'none';
}

function showCodeStep(phone) {
    pendingPhone = phone;
    byId('phoneStep').style.display = 'none';
    byId('codeStep').style.display = 'block';
    byId('codeHelp').textContent =
        `We sent a 6-digit code to ${prettyPhone(phone)}. It expires in 10 minutes.`;
    byId('codeInput').value = '';
    byId('codeInput').focus();
}

function clearSession() {
    localStorage.removeItem(PHONE_KEY);
    localStorage.removeItem(TOKEN_KEY);
}

function setBusy(button, busy, busyText, normalText) {
    button.disabled = busy;
    button.textContent = busy ? busyText : normalText;
}

async function requestCode() {
    const phone = digitsOnly(byId('phoneInput').value);
    if (phone.length !== 10) {
        config.showStatus('Please enter a 10-digit phone number.', 'error');
        return;
    }

    const button = byId('sendCodeBtn');
    setBusy(button, true, 'Sending...', 'Send Verification Code');
    config.showStatus('', '');
    try {
        const response = await fetch('/api/host-verification/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Could not send a verification code. Please check the number and try again.');
        showCodeStep(phone);
    } catch (error) {
        config.showStatus(error.message, 'error');
    } finally {
        setBusy(button, false, 'Sending...', 'Send Verification Code');
    }
}

async function confirmCode() {
    const code = digitsOnly(byId('codeInput').value);
    if (!/^\d{6}$/.test(code)) {
        config.showStatus('Please enter the 6-digit verification code.', 'error');
        return;
    }

    const button = byId('verifyCodeBtn');
    setBusy(button, true, 'Verifying...', 'Verify And Continue');
    config.showStatus('', '');
    try {
        const response = await fetch('/api/host-verification/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: pendingPhone, code })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "That code did not work. It may have expired — tap Send A New Code.");

        localStorage.setItem(PHONE_KEY, data.phoneNumber);
        localStorage.setItem(TOKEN_KEY, data.token);
        byId('phoneGate').style.display = 'none';
        config.showStatus('', '');
        await config.onVerified(data.phoneNumber);
    } catch (error) {
        config.showStatus(error.message, 'error');
    } finally {
        setBusy(button, false, 'Verifying...', 'Verify And Continue');
    }
}

function init(options) {
    config = options;
    byId('sendCodeBtn').addEventListener('click', requestCode);
    byId('phoneInput').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') requestCode();
    });
    byId('verifyCodeBtn').addEventListener('click', confirmCode);
    byId('codeInput').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') confirmCode();
    });
    byId('resendCodeBtn').addEventListener('click', requestCode);
    byId('changeNumberBtn').addEventListener('click', () => {
        config.showStatus('', '');
        showPhoneStep();
        byId('phoneInput').focus();
    });
    byId(options.switchButtonId || 'switchNumber').addEventListener('click', () => {
        clearSession();
        pendingPhone = '';
        byId('phoneInput').value = '';
        config.showStatus('', '');
        showPhoneStep();
        byId('phoneInput').focus();
    });

    const phone = localStorage.getItem(PHONE_KEY) || '';
    const token = localStorage.getItem(TOKEN_KEY) || '';
    if (phone && token) {
        byId('phoneGate').style.display = 'none';
        options.onVerified(phone);
    } else {
        if (phone) byId('phoneInput').value = prettyPhone(phone);
        clearSession();
        showPhoneStep();
    }
}

function authHeaders(extra = {}) {
    const token = localStorage.getItem(TOKEN_KEY) || '';
    return { ...extra, Authorization: `Bearer ${token}` };
}

function expireSession() {
    localStorage.removeItem(TOKEN_KEY);
    config.showStatus(
        'Your session expired. Please verify your number again.',
        'info'
    );
    const phone = localStorage.getItem(PHONE_KEY) || '';
    if (phone) byId('phoneInput').value = prettyPhone(phone);
    showPhoneStep();
}

export {
    init,
    authHeaders,
    expireSession,
    prettyPhone
};
