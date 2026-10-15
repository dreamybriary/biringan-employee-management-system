// ----- Config -----
// There is no backend login route yet. While DEMO_MODE is true, any
// well-formed email/password is accepted and you are sent to the dashboard.
// When your backend is ready, set DEMO_MODE = false and point LOGIN_URL at it.
// It should check `account` (account_email / account_password) and return
// JSON like { "success": true } or { "success": false, "message": "..." }.
// Note: store hashed passwords, not plain text, in account_password.
const DEMO_MODE = true;
const LOGIN_URL = '/api/login';
const REDIRECT_TO = 'index.html';

const form = document.getElementById('login-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const rememberBox = document.getElementById('remember');
const toggleBtn = document.getElementById('toggle-password');
const loginBtn = document.getElementById('login-btn');
const alertBox = document.getElementById('login-alert');
const emailError = document.getElementById('email-error');
const passwordError = document.getElementById('password-error');

// Pre-fill remembered email
try {
    const saved = localStorage.getItem('biringan_email');
    if (saved) {
        emailInput.value = saved;
        rememberBox.checked = true;
    }
} catch (e) { /* storage unavailable */ }

toggleBtn.addEventListener('click', () => {
    const show = passwordInput.type === 'password';
    passwordInput.type = show ? 'text' : 'password';
    toggleBtn.querySelector('i').className = show ? 'fas fa-eye-slash' : 'fas fa-eye';
    toggleBtn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});

document.getElementById('forgot-link').addEventListener('click', (e) => {
    e.preventDefault();
    showAlert('Please contact your administrator to reset your password.', true);
});

function showAlert(message, info = false) {
    alertBox.textContent = message;
    alertBox.classList.toggle('success', info);
    alertBox.hidden = false;
}

function validate() {
    let ok = true;
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    emailError.textContent = '';
    passwordError.textContent = '';
    emailInput.classList.remove('invalid');
    passwordInput.classList.remove('invalid');

    if (!email) {
        emailError.textContent = 'Email is required.';
        ok = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        emailError.textContent = 'Enter a valid email address.';
        ok = false;
    }
    if (!password) {
        passwordError.textContent = 'Password is required.';
        ok = false;
    }

    if (emailError.textContent) emailInput.classList.add('invalid');
    if (passwordError.textContent) passwordInput.classList.add('invalid');
    return ok;
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alertBox.hidden = true;
    if (!validate()) return;

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    loginBtn.disabled = true;
    loginBtn.querySelector('span').textContent = 'Logging in...';

    try {
        let result;
        if (DEMO_MODE) {
            result = { success: true };
        } else {
            const res = await fetch(LOGIN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            result = await res.json();
        }

        if (!result.success) {
            showAlert(result.message || 'Invalid email or password.');
            return;
        }

        try {
            if (rememberBox.checked) localStorage.setItem('biringan_email', email);
            else localStorage.removeItem('biringan_email');
        } catch (err) { /* ignore */ }

        showAlert('Login successful. Redirecting...', true);
        setTimeout(() => { window.location.href = REDIRECT_TO; }, 600);
    } catch (err) {
        showAlert('Could not reach the server. Please try again.');
    } finally {
        loginBtn.disabled = false;
        loginBtn.querySelector('span').textContent = 'Log In';
    }
});
