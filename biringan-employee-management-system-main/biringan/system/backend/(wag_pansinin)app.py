import os
import re
import config
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from decimal import Decimal

import mysql.connector
from flask import Flask, jsonify, render_template, request
from flask.json.provider import DefaultJSONProvider
from mysql.connector import pooling

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------
DB_CONFIG = {
    "host": config.DB_HOST,
    "user": config.DB_USER,
    "password": config.DB_PASSWORD,
    "database": config.DB_NAME,
}

EMPLOYEE_STATUSES = ("Active", "On Leave", "Resigned", "Terminated")
LEAVE_TYPES = ("Vacation", "Sick", "Emergency", "Other")
LEAVE_STATUSES = ("Pending", "Approved", "Rejected")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _json_default(o):
    if isinstance(o, Decimal):
        return float(o)
    if isinstance(o, (datetime, date)):
        return o.isoformat()
    if isinstance(o, timedelta):
        total = int(o.total_seconds())
        return f"{total // 3600:02d}:{(total % 3600) // 60:02d}:{total % 60:02d}"
    return DefaultJSONProvider.default(o)


class AppJSONProvider(DefaultJSONProvider):
    default = staticmethod(_json_default)
    sort_keys = False


app = Flask(
    __name__,
    template_folder="../template",
    static_folder="../statistics",
    static_url_path="/statistics"
)
app.json = AppJSONProvider(app)
app.secret_key = config.SECRET_KEY

# --------------------------------------------------------------------------
# Database helpers
# --------------------------------------------------------------------------
_pool = None


def get_pool():
    global _pool
    if _pool is None:
        _pool = pooling.MySQLConnectionPool(
            pool_name="biri_pool", pool_size=5, pool_reset_session=True, **DB_CONFIG
        )
    return _pool


@contextmanager
def db():
    """Yield (connection, dict-cursor). Commits on success, rolls back on error."""
    conn = get_pool().get_connection()
    cur = conn.cursor(dictionary=True)
    try:
        yield conn, cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def fetch_all(sql, params=None):
    with db() as (_, cur):
        cur.execute(sql, params or ())
        return cur.fetchall()


def fetch_one(sql, params=None):
    with db() as (_, cur):
        cur.execute(sql, params or ())
        return cur.fetchone()


def init_db():
    """Create the small extra table used for the dashboard's Recent Activity."""
    with db() as (_, cur):
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS activity_log (
                activity_id INT AUTO_INCREMENT PRIMARY KEY,
                message     VARCHAR(255) NOT NULL,
                created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )


def log_activity(cur, message):
    cur.execute("INSERT INTO activity_log (message) VALUES (%s)", (message[:255],))


# --------------------------------------------------------------------------
# Errors and validation helpers
# --------------------------------------------------------------------------
class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


@app.errorhandler(ApiError)
def handle_api_error(e):
    return jsonify(error=e.message), e.status


@app.errorhandler(mysql.connector.Error)
def handle_db_error(e):
    errno = getattr(e, "errno", None)
    if errno == 1062:
        return jsonify(error="That value already exists (duplicate entry)."), 409
    if errno == 1451:
        return jsonify(
            error="This record is still used by other records, so it can't be deleted."
        ), 409
    if errno == 1452:
        return jsonify(error="A referenced record doesn't exist."), 400
    if errno in (1045, 1049, 2002, 2003, 2013):
        app.logger.error("Database connection problem: %s", e)
        return jsonify(
            error="Can't connect to the database. Check DB_HOST / DB_USER / "
                  "DB_PASSWORD / DB_NAME and that MySQL is running."
        ), 503
    app.logger.exception("Database error")
    return jsonify(error="Database error."), 500


def clean(value):
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


def to_int(value, field, required=True):
    value = clean(value)
    if value is None:
        if required:
            raise ApiError(f"{field} is required.")
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ApiError(f"{field} must be a whole number.")


def to_money(value, field, required=False):
    value = clean(value)
    if value is None:
        if required:
            raise ApiError(f"{field} is required.")
        return None
    try:
        amount = Decimal(str(value))
    except Exception:
        raise ApiError(f"{field} must be a number.")
    if amount < 0 or amount >= Decimal("100000000"):
        raise ApiError(f"{field} is out of range.")
    return amount.quantize(Decimal("0.01"))


def to_date(value, field):
    value = clean(value)
    if value is None:
        raise ApiError(f"{field} is required.")
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except ValueError:
        raise ApiError(f"{field} must be a date (YYYY-MM-DD).")


def arg_int(name, default, minimum=1, maximum=None):
    try:
        value = int(request.args.get(name, default))
    except (TypeError, ValueError):
        value = default
    value = max(value, minimum)
    if maximum is not None:
        value = min(value, maximum)
    return value


def json_body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError("Request body must be a JSON object.")
    return data


# --------------------------------------------------------------------------
# Pages
# --------------------------------------------------------------------------
@app.get("/")
def index():
    return render_template("index.html")


# --------------------------------------------------------------------------
# Dashboard
# --------------------------------------------------------------------------
@app.get("/api/dashboard")
def dashboard():
    stats = fetch_one(
        """
        SELECT
          (SELECT COUNT(*) FROM employees)                           AS total_employees,
          (SELECT COUNT(*) FROM employees WHERE stat = 'Active')     AS active_employees,
          (SELECT COUNT(*) FROM departments)                         AS total_departments,
          (SELECT COUNT(*) FROM positions)                           AS total_positions,
          (SELECT COUNT(*) FROM leave_requests
             WHERE leave_status = 'Pending')                         AS pending_leaves
        """
    )
    stats["recent_activity"] = fetch_all(
        "SELECT message, created_at FROM activity_log ORDER BY activity_id DESC LIMIT 10"
    )
    return jsonify(stats)


# --------------------------------------------------------------------------
# Employees
# --------------------------------------------------------------------------
EMP_SELECT = """
    SELECT e.employee_id AS id,
           e.first_name, e.last_name,
           CONCAT(e.first_name, ' ', e.last_name) AS name,
           e.email, e.phone,
           e.stat AS status,
           e.salary,
           e.department_id, d.dept_name AS department,
           e.position_id,   p.title     AS position,
           e.manager_id
    FROM employees e
    JOIN departments d ON d.department_id = e.department_id
    JOIN positions   p ON p.position_id   = e.position_id
"""


def get_employee(employee_id):
    return fetch_one(EMP_SELECT + " WHERE e.employee_id = %s", (employee_id,))


def build_employee(data, current=None):
    """Validate a create/update payload; for updates, missing keys keep current values."""
    current = current or {}

    def pick(key):
        return data[key] if key in data else current.get(key)

    first = clean(pick("first_name"))
    last = clean(pick("last_name"))
    email = clean(pick("email"))
    phone = clean(pick("phone"))
    status = clean(pick("status")) or "Active"

    if not first:
        raise ApiError("First name is required.")
    if not last:
        raise ApiError("Last name is required.")
    if not email or not EMAIL_RE.match(email):
        raise ApiError("A valid email is required.")
    if status not in EMPLOYEE_STATUSES:
        raise ApiError(f"Status must be one of: {', '.join(EMPLOYEE_STATUSES)}.")
    if phone and len(phone) > 20:
        raise ApiError("Phone number is too long (max 20 characters).")

    department_id = to_int(pick("department_id"), "Department")
    position_id = to_int(pick("position_id"), "Position")
    manager_id = to_int(pick("manager_id"), "Manager", required=False)
    salary = to_money(pick("salary"), "Salary")

    pos = fetch_one(
        "SELECT department_id FROM positions WHERE position_id = %s", (position_id,)
    )
    if not pos:
        raise ApiError("Selected position doesn't exist.")
    if pos["department_id"] != department_id:
        raise ApiError("The selected position doesn't belong to that department.")
    if manager_id is not None and not fetch_one(
        "SELECT 1 AS ok FROM employees WHERE employee_id = %s", (manager_id,)
    ):
        raise ApiError("Selected manager doesn't exist.")

    return {
        "first_name": first, "last_name": last, "email": email, "phone": phone,
        "status": status, "salary": salary, "department_id": department_id,
        "position_id": position_id, "manager_id": manager_id,
    }


@app.get("/api/employees")
def list_employees():
    page = arg_int("page", 1)
    per_page = arg_int("per_page", 10, 1, 500)
    where, params = [], []

    search = clean(request.args.get("search"))
    if search:
        like = f"%{search}%"
        where.append(
            "(e.first_name LIKE %s OR e.last_name LIKE %s "
            "OR CONCAT(e.first_name, ' ', e.last_name) LIKE %s "
            "OR e.email LIKE %s OR e.phone LIKE %s "
            "OR d.dept_name LIKE %s OR p.title LIKE %s)"
        )
        params += [like] * 7

    status = clean(request.args.get("status"))
    if status:
        where.append("e.stat = %s")
        params.append(status)

    dept = clean(request.args.get("department_id"))
    if dept:
        where.append("e.department_id = %s")
        params.append(to_int(dept, "department_id"))

    where_sql = (" WHERE " + " AND ".join(where)) if where else ""

    total = fetch_one(
        "SELECT COUNT(*) AS n FROM employees e "
        "JOIN departments d ON d.department_id = e.department_id "
        "JOIN positions p ON p.position_id = e.position_id" + where_sql,
        params,
    )["n"]
    pages = max((total + per_page - 1) // per_page, 1)
    page = min(page, pages)

    items = fetch_all(
        EMP_SELECT + where_sql + " ORDER BY e.employee_id LIMIT %s OFFSET %s",
        params + [per_page, (page - 1) * per_page],
    )
    return jsonify(items=items, page=page, per_page=per_page, total=total, pages=pages)


@app.get("/api/employees/<int:employee_id>")
def read_employee(employee_id):
    emp = get_employee(employee_id)
    if not emp:
        raise ApiError("Employee not found.", 404)
    return jsonify(emp)


@app.post("/api/employees")
def create_employee():
    emp = build_employee(json_body())
    with db() as (_, cur):
        cur.execute(
            """INSERT INTO employees
               (first_name, last_name, email, phone, stat, salary,
                department_id, position_id, manager_id)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (emp["first_name"], emp["last_name"], emp["email"], emp["phone"],
             emp["status"], emp["salary"], emp["department_id"],
             emp["position_id"], emp["manager_id"]),
        )
        new_id = cur.lastrowid
        log_activity(cur, f"Added employee {emp['first_name']} {emp['last_name']}")
    return jsonify(get_employee(new_id)), 201


@app.put("/api/employees/<int:employee_id>")
def update_employee(employee_id):
    current = get_employee(employee_id)
    if not current:
        raise ApiError("Employee not found.", 404)
    emp = build_employee(json_body(), current)
    if emp["manager_id"] == employee_id:
        raise ApiError("An employee can't be their own manager.")
    with db() as (_, cur):
        cur.execute(
            """UPDATE employees SET first_name=%s, last_name=%s, email=%s, phone=%s,
                   stat=%s, salary=%s, department_id=%s, position_id=%s, manager_id=%s
               WHERE employee_id=%s""",
            (emp["first_name"], emp["last_name"], emp["email"], emp["phone"],
             emp["status"], emp["salary"], emp["department_id"],
             emp["position_id"], emp["manager_id"], employee_id),
        )
        log_activity(cur, f"Updated employee {emp['first_name']} {emp['last_name']}")
    return jsonify(get_employee(employee_id))


@app.delete("/api/employees/<int:employee_id>")
def delete_employee(employee_id):
    emp = get_employee(employee_id)
    if not emp:
        raise ApiError("Employee not found.", 404)
    if fetch_one("SELECT 1 AS ok FROM payroll WHERE employee_id = %s LIMIT 1", (employee_id,)):
        raise ApiError(
            "This employee has payroll records. Set their status to Resigned or "
            "Terminated instead of deleting.", 409
        )
    with db() as (_, cur):
        cur.execute("UPDATE employees SET manager_id = NULL WHERE manager_id = %s", (employee_id,))
        cur.execute("UPDATE departments SET head_employee_id = NULL WHERE head_employee_id = %s", (employee_id,))
        cur.execute("DELETE FROM attendance WHERE employee_id = %s", (employee_id,))
        cur.execute("DELETE FROM leave_requests WHERE employee_id = %s", (employee_id,))
        cur.execute("DELETE FROM employees WHERE employee_id = %s", (employee_id,))
        log_activity(cur, f"Deleted employee {emp['name']}")
    return jsonify(message="Employee deleted.")


# --------------------------------------------------------------------------
# Departments
# --------------------------------------------------------------------------
@app.get("/api/departments")
def list_departments():
    rows = fetch_all(
        """
        SELECT d.department_id AS id, d.dept_name AS name,
               d.head_employee_id,
               CONCAT(h.first_name, ' ', h.last_name) AS head,
               (SELECT COUNT(*) FROM employees e WHERE e.department_id = d.department_id) AS employees,
               (SELECT COUNT(*) FROM positions p WHERE p.department_id = d.department_id) AS positions
        FROM departments d
        LEFT JOIN employees h ON h.employee_id = d.head_employee_id
        ORDER BY d.department_id
        """
    )
    return jsonify(rows)


def build_department(data):
    name = clean(data.get("dept_name") or data.get("name"))
    if not name:
        raise ApiError("Department name is required.")
    head = to_int(data.get("head_employee_id"), "Head", required=False)
    if head is not None and not fetch_one(
        "SELECT 1 AS ok FROM employees WHERE employee_id = %s", (head,)
    ):
        raise ApiError("Selected department head doesn't exist.")
    return name, head


@app.post("/api/departments")
def create_department():
    name, head = build_department(json_body())
    with db() as (_, cur):
        cur.execute(
            "INSERT INTO departments (dept_name, head_employee_id) VALUES (%s, %s)", (name, head)
        )
        new_id = cur.lastrowid
        log_activity(cur, f"Added department {name}")
    return jsonify(id=new_id, name=name, head_employee_id=head), 201


@app.put("/api/departments/<int:department_id>")
def update_department(department_id):
    if not fetch_one("SELECT 1 AS ok FROM departments WHERE department_id = %s", (department_id,)):
        raise ApiError("Department not found.", 404)
    name, head = build_department(json_body())
    with db() as (_, cur):
        cur.execute(
            "UPDATE departments SET dept_name = %s, head_employee_id = %s WHERE department_id = %s",
            (name, head, department_id),
        )
        log_activity(cur, f"Updated department {name}")
    return jsonify(id=department_id, name=name, head_employee_id=head)


@app.delete("/api/departments/<int:department_id>")
def delete_department(department_id):
    dept = fetch_one("SELECT dept_name FROM departments WHERE department_id = %s", (department_id,))
    if not dept:
        raise ApiError("Department not found.", 404)
    with db() as (_, cur):
        cur.execute("DELETE FROM departments WHERE department_id = %s", (department_id,))
        log_activity(cur, f"Deleted department {dept['dept_name']}")
    return jsonify(message="Department deleted.")


# --------------------------------------------------------------------------
# Positions
# --------------------------------------------------------------------------
@app.get("/api/positions")
def list_positions():
    sql = """
        SELECT p.position_id AS id, p.title, p.department_id,
               d.dept_name AS department,
               (SELECT COUNT(*) FROM employees e WHERE e.position_id = p.position_id) AS employees
        FROM positions p
        JOIN departments d ON d.department_id = p.department_id
    """
    params = []
    dept = clean(request.args.get("department_id"))
    if dept:
        sql += " WHERE p.department_id = %s"
        params.append(to_int(dept, "department_id"))
    sql += " ORDER BY p.department_id, p.position_id"
    return jsonify(fetch_all(sql, params))


def build_position(data):
    title = clean(data.get("title"))
    if not title:
        raise ApiError("Position title is required.")
    department_id = to_int(data.get("department_id"), "Department")
    if not fetch_one("SELECT 1 AS ok FROM departments WHERE department_id = %s", (department_id,)):
        raise ApiError("Selected department doesn't exist.")
    return title, department_id


@app.post("/api/positions")
def create_position():
    title, department_id = build_position(json_body())
    with db() as (_, cur):
        cur.execute(
            "INSERT INTO positions (title, department_id) VALUES (%s, %s)", (title, department_id)
        )
        new_id = cur.lastrowid
        log_activity(cur, f"Added position {title}")
    return jsonify(id=new_id, title=title, department_id=department_id), 201


@app.put("/api/positions/<int:position_id>")
def update_position(position_id):
    if not fetch_one("SELECT 1 AS ok FROM positions WHERE position_id = %s", (position_id,)):
        raise ApiError("Position not found.", 404)
    title, department_id = build_position(json_body())
    with db() as (_, cur):
        cur.execute(
            "UPDATE positions SET title = %s, department_id = %s WHERE position_id = %s",
            (title, department_id, position_id),
        )
        log_activity(cur, f"Updated position {title}")
    return jsonify(id=position_id, title=title, department_id=department_id)


@app.delete("/api/positions/<int:position_id>")
def delete_position(position_id):
    pos = fetch_one("SELECT title FROM positions WHERE position_id = %s", (position_id,))
    if not pos:
        raise ApiError("Position not found.", 404)
    with db() as (_, cur):
        cur.execute("DELETE FROM positions WHERE position_id = %s", (position_id,))
        log_activity(cur, f"Deleted position {pos['title']}")
    return jsonify(message="Position deleted.")


# --------------------------------------------------------------------------
# Salaries and payroll
# --------------------------------------------------------------------------
@app.get("/api/salaries")
def list_salaries():
    items = fetch_all(
        """
        SELECT e.employee_id AS id,
               CONCAT(e.first_name, ' ', e.last_name) AS name,
               d.dept_name AS department, p.title AS position,
               e.stat AS status, e.salary
        FROM employees e
        JOIN departments d ON d.department_id = e.department_id
        JOIN positions   p ON p.position_id   = e.position_id
        ORDER BY e.employee_id
        """
    )
    summary = fetch_one(
        """
        SELECT COALESCE(SUM(salary), 0) AS total_monthly,
               COALESCE(ROUND(AVG(salary), 2), 0) AS average,
               COALESCE(MAX(salary), 0) AS highest
        FROM employees WHERE stat = 'Active'
        """
    )
    return jsonify(items=items, summary=summary)


@app.put("/api/salaries/<int:employee_id>")
def update_salary(employee_id):
    emp = get_employee(employee_id)
    if not emp:
        raise ApiError("Employee not found.", 404)
    salary = to_money(json_body().get("salary"), "Salary", required=True)
    with db() as (_, cur):
        cur.execute("UPDATE employees SET salary = %s WHERE employee_id = %s", (salary, employee_id))
        log_activity(cur, f"Updated salary of {emp['name']}")
    return jsonify(id=employee_id, salary=salary)


@app.get("/api/payroll")
def list_payroll():
    sql = """
        SELECT pr.payroll_id AS id, pr.employee_id,
               CONCAT(e.first_name, ' ', e.last_name) AS employee,
               pr.pay_period, pr.gross_pay, pr.deductions, pr.net_pay
        FROM payroll pr
        JOIN employees e ON e.employee_id = pr.employee_id
    """
    params = []
    emp = clean(request.args.get("employee_id"))
    if emp:
        sql += " WHERE pr.employee_id = %s"
        params.append(to_int(emp, "employee_id"))
    sql += " ORDER BY pr.pay_period DESC, pr.payroll_id DESC"
    return jsonify(fetch_all(sql, params))


@app.post("/api/payroll")
def create_payroll():
    data = json_body()
    employee_id = to_int(data.get("employee_id"), "Employee")
    pay_period = to_date(data.get("pay_period"), "Pay period")
    gross = to_money(data.get("gross_pay"), "Gross pay", required=True)
    deductions = to_money(data.get("deductions"), "Deductions") or Decimal("0.00")
    if deductions > gross:
        raise ApiError("Deductions can't be greater than gross pay.")
    emp = get_employee(employee_id)
    if not emp:
        raise ApiError("Employee not found.", 404)
    net = gross - deductions
    with db() as (_, cur):
        cur.execute(
            """INSERT INTO payroll (employee_id, pay_period, gross_pay, deductions, net_pay)
               VALUES (%s, %s, %s, %s, %s)""",
            (employee_id, pay_period, gross, deductions, net),
        )
        new_id = cur.lastrowid
        log_activity(cur, f"Recorded payroll for {emp['name']} ({pay_period})")
    return jsonify(id=new_id, net_pay=net), 201


# --------------------------------------------------------------------------
# Leaves
# --------------------------------------------------------------------------
LEAVE_SELECT = """
    SELECT l.leave_id AS id, l.employee_id,
           CONCAT(e.first_name, ' ', e.last_name) AS employee,
           d.dept_name AS department,
           l.leave_type, l.start_date, l.end_date,
           DATEDIFF(l.end_date, l.start_date) + 1 AS days,
           l.leave_status AS status
    FROM leave_requests l
    JOIN employees   e ON e.employee_id   = l.employee_id
    JOIN departments d ON d.department_id = e.department_id
"""


@app.get("/api/leaves")
def list_leaves():
    sql, params = LEAVE_SELECT, []
    status = clean(request.args.get("status"))
    if status:
        sql += " WHERE l.leave_status = %s"
        params.append(status)
    sql += " ORDER BY (l.leave_status = 'Pending') DESC, l.start_date DESC, l.leave_id DESC"
    return jsonify(fetch_all(sql, params))


@app.post("/api/leaves")
def create_leave():
    data = json_body()
    employee_id = to_int(data.get("employee_id"), "Employee")
    leave_type = clean(data.get("leave_type"))
    if leave_type not in LEAVE_TYPES:
        raise ApiError(f"Leave type must be one of: {', '.join(LEAVE_TYPES)}.")
    start, end = to_date(data.get("start_date"), "Start date"), to_date(data.get("end_date"), "End date")
    if end < start:
        raise ApiError("End date can't be before the start date.")
    emp = get_employee(employee_id)
    if not emp:
        raise ApiError("Employee not found.", 404)
    with db() as (_, cur):
        cur.execute(
            """INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date)
               VALUES (%s, %s, %s, %s)""",
            (employee_id, leave_type, start, end),
        )
        new_id = cur.lastrowid
        log_activity(cur, f"{emp['name']} filed a {leave_type.lower()} leave")
    return jsonify(id=new_id), 201


@app.put("/api/leaves/<int:leave_id>/status")
def update_leave_status(leave_id):
    status = clean(json_body().get("status"))
    if status not in LEAVE_STATUSES:
        raise ApiError(f"Status must be one of: {', '.join(LEAVE_STATUSES)}.")
    leave = fetch_one(LEAVE_SELECT + " WHERE l.leave_id = %s", (leave_id,))
    if not leave:
        raise ApiError("Leave request not found.", 404)
    with db() as (_, cur):
        cur.execute("UPDATE leave_requests SET leave_status = %s WHERE leave_id = %s", (status, leave_id))
        log_activity(cur, f"{status} leave request of {leave['employee']}")
    return jsonify(id=leave_id, status=status)


@app.delete("/api/leaves/<int:leave_id>")
def delete_leave(leave_id):
    if not fetch_one("SELECT 1 AS ok FROM leave_requests WHERE leave_id = %s", (leave_id,)):
        raise ApiError("Leave request not found.", 404)
    with db() as (_, cur):
        cur.execute("DELETE FROM leave_requests WHERE leave_id = %s", (leave_id,))
    return jsonify(message="Leave request deleted.")


# --------------------------------------------------------------------------
# Reports
# --------------------------------------------------------------------------
@app.get("/api/reports")
def reports():
    return jsonify(
        headcount_by_department=fetch_all(
            """
            SELECT d.dept_name AS department,
                   COUNT(e.employee_id) AS total,
                   COUNT(CASE WHEN e.stat = 'Active' THEN 1 END) AS active
            FROM departments d
            LEFT JOIN employees e ON e.department_id = d.department_id
            GROUP BY d.department_id, d.dept_name
            ORDER BY d.department_id
            """
        ),
        status_breakdown=fetch_all(
            "SELECT stat AS status, COUNT(*) AS total FROM employees GROUP BY stat ORDER BY total DESC"
        ),
        leave_summary=fetch_all(
            "SELECT leave_status AS status, COUNT(*) AS total FROM leave_requests "
            "GROUP BY leave_status ORDER BY total DESC"
        ),
        salary_by_department=fetch_all(
            """
            SELECT d.dept_name AS department,
                   COALESCE(ROUND(AVG(e.salary), 2), 0) AS average,
                   COALESCE(SUM(e.salary), 0) AS total
            FROM departments d
            LEFT JOIN employees e ON e.department_id = d.department_id AND e.stat = 'Active'
            GROUP BY d.department_id, d.dept_name
            ORDER BY d.department_id
            """
        ),
    )


# --------------------------------------------------------------------------
if __name__ == "__main__":
    try:
        init_db()
    except mysql.connector.Error as err:
        print(f"[warning] Could not reach the database yet: {err}")
    app.run(host="127.0.0.1", port=5000, debug=os.getenv("FLASK_DEBUG", "1") == "1")