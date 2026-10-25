const DEMO_MODE = false;
const LOGIN_URL = '/api/login';
const REDIRECT_TO = '/';

const form = document.getElementById('login-form');
const codeInput = document.getElementById('employee-code');
const passwordInput = document.getElementById('password');
const rememberBox = document.getElementById('remember');
const toggleBtn = document.getElementById('toggle-password');
const loginBtn = document.getElementById('login-btn');
const alertBox = document.getElementById('login-alert');
const codeError = document.getElementById('code-error');
const passwordError = document.getElementById('password-error');

// Pre-fill remembered employee ID
try {
    const saved = localStorage.getItem('biringan_code');
    if (saved) {
        codeInput.value = saved;
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
    const code = codeInput.value.trim();
    const password = passwordInput.value;

    codeError.textContent = '';
    passwordError.textContent = '';
    codeInput.classList.remove('invalid');
    passwordInput.classList.remove('invalid');

    if (!code) {
        codeError.textContent = 'Employee ID is required.';
        ok = false;
    } else if (!/^biri-\d{6}$/i.test(code)) {
        codeError.textContent = 'Format must be biri- followed by 6 digits.';
        ok = false;
    }
    if (!password) {
        passwordError.textContent = 'Password is required.';
        ok = false;
    }

    if (codeError.textContent) codeInput.classList.add('invalid');
    if (passwordError.textContent) passwordInput.classList.add('invalid');
    return ok;
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alertBox.hidden = true;
    if (!validate()) return;

    const code = codeInput.value.trim();
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
                body: JSON.stringify({ employee_code: code, password })
            });
            result = await res.json();
        }

        if (!result.success) {
            showAlert(result.message || 'Invalid employee ID or password.');
            return;
        }

        try {
            if (rememberBox.checked) localStorage.setItem('biringan_code', code);
            else localStorage.removeItem('biringan_code');
        } catch (err) { /* ignore */ }

        showAlert('Login successful. Redirecting...', true);
        setTimeout(() => { window.location.href = result.redirect || REDIRECT_TO; }, 600);
    } catch (err) {
        showAlert('Could not reach the server. Please try again.');
    } finally {
        loginBtn.disabled = false;
        loginBtn.querySelector('span').textContent = 'Log In';
    }
});