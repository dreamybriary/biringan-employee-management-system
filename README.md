# Bri-Go — Biringan Employee Management System

A role-based employee management web app built with **Flask** and **MySQL**. Bri-Go is a logistic company while this system is the employee management system for the said logistic company

> ⚠️ **Status: work in progress.** The admin dashboard and the HR / owner API endpoints are implemented. The dedicated HR, Owner, and Employee pages are planned but not built yet. See [Roadmap](#roadmap) and read [SECURITY.md](SECURITY.md) before deploying anywhere public.

---

## Features

- **Role-based access control** — four roles: `admin`, `hr`, `owner`, `employee`, enforced per endpoint with a `@role_required` decorator.
- **Employee management** — create, search, filter, update, and remove employee records (name, sex, birthday, contact info, status, salary, department, position).
- **Departments & positions** — manage the org structure, with positions scoped to departments.
- **Leave requests** — file, approve, reject, and delete leave (Vacation, Sick, Emergency, Other).
- **Payroll** — record pay periods with gross pay, deductions, and net pay.
- **Salaries & reports** — salary summaries, headcount by department, status breakdown, leave summary, and average/total salary by department.
- **Activity log** — a "Recent Activity" feed on the dashboard.
- **Secure password storage** — passwords are hashed with Werkzeug (scrypt); parameterized SQL queries throughout.

## Tech stack

| Layer     | Technology                                   |
|-----------|----------------------------------------------|
| Backend   | Python 3, Flask, Werkzeug                    |
| Database  | MySQL (via `mysql-connector-python`, pooled) |
| Frontend  | HTML templates, vanilla JavaScript, CSS      |

## Project structure

```
biringan/system/
├── Biri-Go.sql              # Database schema + seed data
├── backend/
│   ├── main.py              # App entry point, login/logout, employee account routes
│   ├── auth.py              # role_required decorator
│   ├── config.py            # Secret key and database settings
│   ├── db.py                # Connection pool, helpers, activity log
│   ├── utils.py             # Validation helpers, JSON provider, ApiError
│   ├── owner.py
│   └── routes/
│       ├── admin.py         # Dashboard, departments, positions
│       ├── hr.py            # Employees, payroll, leave
│       ├── owner.py         # Salaries and reports
│       └── employee.py      # (planned)
├── template/
│   ├── login.html
│   └── admin.html
└── statistics/              # Static assets (served at /statistics)
    ├── css/  (admin.css, login.css)
    └── js/   (admin.js, login.js)
```

## Getting started

### Prerequisites

- Python 3.10+
- MySQL 8.x (or compatible MariaDB)

### 1. Clone and install

```bash
git clone https://github.com/<your-username>/biringan-employee-management-system.git
cd biringan-employee-management-system/biringan/system

python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

pip install flask mysql-connector-python
```

### 2. Set up the database

```bash
mysql -u root -p < Biri-Go.sql
```

This creates the `biri_go` database, all tables, and seed departments and positions. The script also inserts an initial admin account (`admin@biringan.com`, employee ID `biri-000000`).

> 🔐 **Change the seeded admin password immediately** after first login. Do not use the seed account in any shared or production environment. See [SECURITY.md](SECURITY.md).

### 3. Configure

Edit `backend/config.py` with your own values:

```python
SECRET_KEY  = "<long random string>"   # e.g. python -c "import secrets; print(secrets.token_hex(32))"
DB_HOST     = "localhost"
DB_USER     = "<db user>"
DB_PASSWORD = "<db password>"
DB_NAME     = "biri_go"
```

**Never commit real credentials.** Prefer environment variables or an untracked config file, and use a dedicated, least-privilege MySQL user instead of `root`.

### 4. Run

```bash
cd backend
python main.py
```

Open <http://127.0.0.1:5000> and sign in with an employee ID (format `biri-000000`) and password.

For anything beyond local development, run behind a production WSGI server (e.g. Gunicorn or Waitress) with `debug` disabled and HTTPS enabled.

## Roles and permissions

| Capability                         | admin | hr  | owner | employee |
|------------------------------------|:-----:|:---:|:-----:|:--------:|
| Dashboard                          |  ✅   |     |       |          |
| Manage departments & positions     |  ✅   |     |       |          |
| View departments & positions       |  ✅   | ✅  |       |          |
| Manage employees, payroll, leave   |  ✅   | ✅  |       |          |
| View/update salaries               |  ✅   |     |  ✅   |          |
| View reports                       |  ✅   |     |  ✅   |          |

## API overview

All endpoints return JSON and require an authenticated session with the appropriate role.

| Method | Endpoint                              | Roles           |
|--------|---------------------------------------|-----------------|
| POST   | `/api/login`                          | public          |
| GET    | `/logout`                             | any             |
| GET    | `/api/dashboard`                      | admin           |
| GET/POST/PUT/DELETE | `/api/departments[/<id>]` | admin (GET: +hr) |
| GET/POST/PUT/DELETE | `/api/positions[/<id>]`   | admin (GET: +hr) |
| GET/POST/PUT/DELETE | `/api/employees[/<id>]`   | admin, hr       |
| GET/POST | `/api/payroll`                      | admin, hr       |
| GET/POST/DELETE | `/api/leaves[/<id>]`         | admin, hr       |
| PUT    | `/api/leaves/<id>/status`             | admin, hr       |
| GET    | `/api/salaries`                       | admin, owner    |
| PUT    | `/api/salaries/<id>`                  | admin, owner    |
| GET    | `/api/reports`                        | admin, owner    |

## Roadmap

- [ ] HR, Owner, and Employee dashboards (`/hr`, `/owner`, `/employee`)
- [ ] Employee self-service (view own profile, payslips, file leave)
- [ ] Attendance tracking UI (table already exists in the schema)
- [ ] CSRF protection, login rate limiting, and password change/reset
- [ ] Environment-based configuration
- [ ] Automated tests

## Contributing

Contributions are welcome! Please read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) first. To contribute:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-change`
3. Commit your changes with clear messages
4. Push and open a Pull Request describing what and why

Found a security issue? **Do not open a public issue** — follow [SECURITY.md](SECURITY.md).


## Acknowledgements

Built with [Flask](https://flask.palletsprojects.com/) and [MySQL](https://www.mysql.com/).
