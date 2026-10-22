# Security Policy

Biri-Go handles sensitive HR data — personal details, salaries, and payroll. We take security seriously and appreciate responsible disclosure.

## Supported versions

This project is under active development. Only the latest commit on the `main` branch receives security fixes.

| Version        | Supported |
|----------------|:---------:|
| `main` (latest)|    ✅     |
| older commits  |    ❌     |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

Instead, use one of the following private channels:

1. **GitHub Private Vulnerability Reporting** (preferred): go to the repository's **Security** tab → **Report a vulnerability**.
2. **Email:** `<jettstefando@gmail.com>` *(replace with your contact address)*.

Please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce, or a proof of concept
- Affected files, endpoints, or versions
- Any suggested fix, if you have one

### What to expect

| Step                         | Target timeframe |
|------------------------------|------------------|
| Acknowledgement of your report | within 3 business days |
| Initial assessment           | within 7 days    |
| Fix or mitigation plan       | within 30 days, depending on severity |
| Public disclosure            | after a fix is available, coordinated with you |

We will credit reporters in the release notes unless you prefer to remain anonymous.

## Scope

**In scope**

- Authentication and session handling (`/api/login`, `/logout`)
- Role-based authorization bypass (`@role_required`)
- SQL injection, XSS, CSRF, and other injection flaws
- Exposure of employee, salary, or payroll data
- Insecure defaults in the code or database schema

**Out of scope**

- Vulnerabilities in third-party dependencies with no demonstrable impact on this project (report those upstream)
- Attacks requiring physical access or an already-compromised server
- Denial-of-service through brute volume
- Social engineering of maintainers or users

## Safe harbor

If you act in good faith — avoid accessing data that isn't yours, avoid degrading the service for others, and give us reasonable time to respond before disclosing — we will not pursue legal action against you.

## Known limitations and hardening checklist

This is a student/early-stage project. If you deploy it, **you are responsible for addressing the following** before exposing it to real users or data:

### Must fix before any real deployment

- [ ] **Hard-coded secrets.** `backend/config.py` ships with a placeholder `SECRET_KEY` and database credentials. Replace them with strong, unique values loaded from environment variables, and never commit them. If real credentials were ever committed, **rotate them** and treat them as compromised, including in Git history.
- [ ] **Seeded admin account.** `Biri-Go.sql` inserts a default admin (`admin@biringan.com`) with a password hash that is publicly visible in the repository. Delete it or set a new password before first use.
- [ ] **Debug mode.** `app.run(debug=True)` exposes the Werkzeug debugger, which allows remote code execution. Disable it and run behind Gunicorn/Waitress.
- [ ] **Database user.** Use a dedicated least-privilege MySQL user, not `root`.
- [ ] **HTTPS.** Serve only over TLS and set session cookie flags: `SESSION_COOKIE_SECURE=True`, `SESSION_COOKIE_HTTPONLY=True`, `SESSION_COOKIE_SAMESITE="Lax"`.

### Recommended improvements

- [ ] CSRF protection on state-changing endpoints (e.g. Flask-WTF `CSRFProtect`)
- [ ] Rate limiting / lockout on `/api/login` (e.g. Flask-Limiter)
- [ ] Session lifetime limits and server-side session invalidation
- [ ] Restrict salary modification to the `owner` role (see the note in `routes/owner.py`)
- [ ] Return generic error messages; avoid exposing database error details to clients
- [ ] Audit logging for sensitive actions (salary, payroll, role changes)
- [ ] Security headers (CSP, `X-Content-Type-Options`, `X-Frame-Options`)
- [ ] Dependency scanning (Dependabot) and pinned versions in a `requirements.txt`
- [ ] Add `__pycache__/` and `config.py` secrets to `.gitignore`

### Good practices already in place

- Passwords are hashed with Werkzeug (scrypt) and verified with `check_password_hash`
- SQL queries use parameterized statements
- Endpoints are protected with role-based decorators
- Input is validated and normalized in `utils.py`

## Data protection note

This system stores personal data and compensation information. Depending on where you operate, laws such as the Philippines' Data Privacy Act of 2012 (RA 10173), GDPR, or similar may apply. Deployers are responsible for compliance, including access controls, retention, and breach notification.
