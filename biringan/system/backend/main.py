import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

import mysql.connector
from flask import Flask, jsonify, render_template
from flask import session, redirect
from flask import request
import secrets

import config
from auth import role_required
from db import init_db, db
from utils import ApiError, AppJSONProvider
from routes.employee import employee_bp
from routes.admin import admin_bp
from routes.hr import hr_bp
from routes.owner import owner_bp
from werkzeug.security import check_password_hash, generate_password_hash


app = Flask(__name__, template_folder="../template",
            static_folder="../statistics", static_url_path="/statistics")
app.json = AppJSONProvider(app)
app.secret_key = config.SECRET_KEY

app.register_blueprint(employee_bp)
app.register_blueprint(admin_bp)
app.register_blueprint(hr_bp)
app.register_blueprint(owner_bp)


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
    if errno == 1054:
        app.logger.error("Missing column: %s", e)
        return jsonify(error="Database column missing: " + str(getattr(e, "msg", e))), 500
    app.logger.exception("Database error")
    return jsonify(error="Database error."), 500


@app.route("/")
def index():
    return render_template("login.html")


@app.route("/admin")
@role_required("admin")
def admin_page():
    return render_template("admin.html")



ROLE_HOME = {"admin": "/admin", "hr": "/hr", "owner": "/owner", "employee": "/employee"}  # match your blueprint URLs

@app.route("/api/login", methods=["POST"])
def api_login():
    data = request.get_json(silent=True) or {}
    code = (data.get("employee_code") or "").strip().lower()
    password = data.get("password") or ""

    with db() as (conn, cur):
        cur.execute(
            "SELECT account_id, account_password, account_role AS role "
            "FROM account WHERE employee_code = %s",
            (code,),
        )
        row = cur.fetchone()

    if not row or not check_password_hash(row["account_password"], password):
        return jsonify(success=False, message="Invalid employee ID or password."), 401

    session["account_id"] = row["account_id"]
    session["role"] = row["role"]
    return jsonify(success=True, redirect=ROLE_HOME.get(row["role"], "/"))

ACCOUNT_ROLES = ("admin", "hr", "owner", "employee")
EMPLOYEE_STATUSES = ("Active", "On Leave", "Resigned", "Terminated")
SEX_VALUES = ("Male", "Female")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _json_object():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError("Request body must be a JSON object.")
    return data


def _text(data, key):
    value = data.get(key)
    return value.strip() if isinstance(value, str) else ""


def parse_employee_form(data, require_job=True):
    """Validate the personal/job fields shared by Add Account and Edit Employee."""
    first, middle, last = _text(data, "first_name"), _text(data, "middle_name"), _text(data, "last_name")
    suffix, sex, phone = _text(data, "suffix"), _text(data, "sex"), _text(data, "phone")
    email = _text(data, "email").lower()

    if not first or len(first) > 50:
        raise ApiError("First name is required (max 50 characters).")
    if len(middle) > 50:
        raise ApiError("Middle name is too long (max 50 characters).")
    if not last or len(last) > 50:
        raise ApiError("Last name is required (max 50 characters).")
    if not suffix:
        raise ApiError("Suffix is required. Enter 'None' if you don't have one.")
    if len(suffix) > 20:
        raise ApiError("Suffix is too long (max 20 characters).")
    if suffix.lower() == "none":
        suffix = None
    if sex not in SEX_VALUES:
        raise ApiError("Please select a sex.")

    try:
        birthday = datetime.strptime(_text(data, "birthday"), "%Y-%m-%d").date()
    except ValueError:
        raise ApiError("Birthday must be a valid date.")
    if birthday > date.today() or birthday.year < 1900:
        raise ApiError("Birthday is out of range.")

    if not email or not EMAIL_RE.match(email) or len(email) > 100:
        raise ApiError("A valid email is required.")
    if len(phone) > 20:
        raise ApiError("Phone number is too long (max 20 characters).")

    department_id = position_id = None
    if require_job:
        try:
            department_id = int(data.get("department_id"))
            position_id = int(data.get("position_id"))
        except (TypeError, ValueError):
            raise ApiError("Please select a department and a position.")

    raw_salary = data.get("salary")
    raw_salary = str(raw_salary).strip() if raw_salary is not None else ""
    salary = None
    if raw_salary:
        try:
            salary = Decimal(raw_salary)
        except InvalidOperation:
            raise ApiError("Salary must be a number.")
        if salary < 0 or salary >= Decimal("100000000"):
            raise ApiError("Salary is out of range.")
        salary = salary.quantize(Decimal("0.01"))

    return {
        "first_name": first, "middle_name": middle or None, "last_name": last,
        "suffix": suffix, "sex": sex, "birthday": birthday, "email": email,
        "phone": phone or None, "salary": salary,
        "department_id": department_id, "position_id": position_id,
    }


def check_position(cur, department_id, position_id):
    cur.execute("SELECT department_id FROM positions WHERE position_id = %s", (position_id,))
    pos = cur.fetchone()
    if not pos:
        raise ApiError("Selected position doesn't exist.")
    if pos["department_id"] != department_id:
        raise ApiError("The selected position doesn't belong to that department.")

def generate_employee_code(cur):
    """Return a unique ID like biri-048213."""
    for _ in range(20):
        code = "biri-%06d" % secrets.randbelow(1_000_000)
        cur.execute("SELECT 1 AS ok FROM account WHERE employee_code = %s", (code,))
        if not cur.fetchone():
            return code
    raise ApiError("Could not generate a unique employee ID. Please try again.", 500)


def account_has_employee_link(cur):
    cur.execute("SHOW COLUMNS FROM account LIKE 'employee_id'")
    return cur.fetchone() is not None


@app.route("/api/accounts/options")
@role_required("admin")
def account_options():
    """Departments and positions used by the Add Account / Edit Employee forms."""
    with db() as (conn, cur):
        cur.execute(
            "SELECT department_id AS id, dept_name AS name "
            "FROM departments ORDER BY department_id"
        )
        departments = cur.fetchall()
        cur.execute(
            "SELECT position_id AS id, title, department_id "
            "FROM positions ORDER BY department_id, position_id"
        )
        positions = cur.fetchall()
    return jsonify(departments=departments, positions=positions)

def generate_employee_code(cur):
    """Return a unique ID like biri-048213."""
    for _ in range(20):
        code = "biri-%06d" % secrets.randbelow(1_000_000)
        cur.execute("SELECT 1 AS ok FROM account WHERE employee_code = %s", (code,))
        if not cur.fetchone():
            return code
    raise ApiError("Could not generate a unique employee ID. Please try again.", 500)

@app.route("/api/accounts", methods=["POST"])
@role_required("admin")
def create_account():
    """Create an employee record and its login account in one transaction."""
    data = _json_object()
    role = _text(data, "role").lower()
    emp = parse_employee_form(data, require_job=(role != "admin"))
    password = data.get("password") or ""

    if role not in ACCOUNT_ROLES:
        raise ApiError("Role must be one of: " + ", ".join(ACCOUNT_ROLES) + ".")
    if len(password) < 8:
        raise ApiError("Password must be at least 8 characters.")

    with db() as (conn, cur):
        cur.execute("SELECT 1 AS ok FROM account WHERE account_email = %s", (emp["email"],))
        if cur.fetchone():
            raise ApiError("An account with that email already exists.", 409)
        cur.execute("SELECT 1 AS ok FROM employees WHERE email = %s", (emp["email"],))
        if cur.fetchone():
            raise ApiError("An employee with that email already exists.", 409)
        if emp["department_id"] is not None:
            check_position(cur, emp["department_id"], emp["position_id"])
            
        cur.execute(
            "INSERT INTO employees "
            "(first_name, middle_name, last_name, suffix, sex, birthday, "
            " email, phone, stat, salary, department_id, position_id) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'Active', %s, %s, %s)",
            (emp["first_name"], emp["middle_name"], emp["last_name"], emp["suffix"],
             emp["sex"], emp["birthday"], emp["email"], emp["phone"], emp["salary"],
             emp["department_id"], emp["position_id"]),
        )
        employee_id = cur.lastrowid

        hashed = generate_password_hash(password)
        employee_code = generate_employee_code(cur)
        if account_has_employee_link(cur):
            cur.execute(
                "INSERT INTO account (employee_code, employee_id, account_email, account_password, account_role) "
                "VALUES (%s, %s, %s, %s, %s)",
                (employee_code, employee_id, emp["email"], hashed, role),
            )
        else:
            cur.execute(
                "INSERT INTO account (employee_code, account_email, account_password, account_role) "
                "VALUES (%s, %s, %s, %s)",
                (employee_code, emp["email"], hashed, role),
            )
        account_id = cur.lastrowid

        cur.execute(
            "INSERT INTO activity_log (message) VALUES (%s)",
            (("Added employee %s %s with %s account" % (emp["first_name"], emp["last_name"], role))[:255],),
        )
        conn.commit()

    return jsonify(id=account_id, employee_id=employee_id, employee_code=employee_code, email=emp["email"], role=role), 201


@app.route("/api/accounts/employees/<int:employee_id>", methods=["GET"])
@role_required("admin")
def get_employee_for_edit(employee_id):
    """Full employee record (including the extra personal fields) for the Edit form."""
    with db() as (conn, cur):
        cur.execute(
            "SELECT employee_id AS id, first_name, middle_name, last_name, suffix, sex, "
            "       birthday, email, phone, stat AS status, salary, department_id, position_id "
            "FROM employees WHERE employee_id = %s",
            (employee_id,),
        )
        row = cur.fetchone()
    if not row:
        raise ApiError("Employee not found.", 404)
    row["birthday"] = str(row["birthday"])[:10] if row.get("birthday") else ""
    row["salary"] = float(row["salary"]) if row.get("salary") is not None else ""
    return jsonify(row)


@app.route("/api/accounts/employees/<int:employee_id>", methods=["PUT"])
@role_required("admin")
def update_employee_profile(employee_id):
    """Save the Edit Employee form. A changed email is also applied to the login account."""
    data = _json_object()
    emp = parse_employee_form(data)
    status = _text(data, "status") or "Active"
    if status not in EMPLOYEE_STATUSES:
        raise ApiError("Status must be one of: " + ", ".join(EMPLOYEE_STATUSES) + ".")

    with db() as (conn, cur):
        cur.execute("SELECT email FROM employees WHERE employee_id = %s", (employee_id,))
        current = cur.fetchone()
        if not current:
            raise ApiError("Employee not found.", 404)
        old_email = current["email"]

        cur.execute(
            "SELECT 1 AS ok FROM employees WHERE email = %s AND employee_id <> %s",
            (emp["email"], employee_id),
        )
        if cur.fetchone():
            raise ApiError("Another employee already uses that email.", 409)

        linked = account_has_employee_link(cur)
        if linked:
            cur.execute(
                "SELECT 1 AS ok FROM account WHERE account_email = %s "
                "AND (employee_id IS NULL OR employee_id <> %s)",
                (emp["email"], employee_id),
            )
        else:
            cur.execute(
                "SELECT 1 AS ok FROM account WHERE account_email = %s AND account_email <> %s",
                (emp["email"], old_email),
            )
        if cur.fetchone():
            raise ApiError("Another account already uses that email.", 409)

        check_position(cur, emp["department_id"], emp["position_id"])

        cur.execute(
            "UPDATE employees SET first_name=%s, middle_name=%s, last_name=%s, suffix=%s, "
            "sex=%s, birthday=%s, email=%s, phone=%s, stat=%s, salary=%s, "
            "department_id=%s, position_id=%s WHERE employee_id=%s",
            (emp["first_name"], emp["middle_name"], emp["last_name"], emp["suffix"],
             emp["sex"], emp["birthday"], emp["email"], emp["phone"], status, emp["salary"],
             emp["department_id"], emp["position_id"], employee_id),
        )

        if emp["email"] != old_email:
            if linked:
                cur.execute(
                    "UPDATE account SET account_email = %s WHERE employee_id = %s",
                    (emp["email"], employee_id),
                )
            else:
                cur.execute(
                    "UPDATE account SET account_email = %s WHERE account_email = %s",
                    (emp["email"], old_email),
                )

        cur.execute(
            "INSERT INTO activity_log (message) VALUES (%s)",
            (("Updated employee %s %s" % (emp["first_name"], emp["last_name"]))[:255],),
        )
        conn.commit()

    return jsonify(id=employee_id, message="Employee updated.")


@app.route("/logout")
def logout():
    session.clear()
    return redirect("/")



if __name__ == "__main__":
    try:
        init_db()
    except mysql.connector.Error as err:
        print(f"[warning] Could not reach the database yet: {err}")
    app.run(debug=True)