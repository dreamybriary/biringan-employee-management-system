from decimal import Decimal

from flask import Blueprint, jsonify, request

from auth import role_required
from db import db, fetch_all, fetch_one, log_activity
from utils import (
    ApiError, clean, to_int, to_money, to_date, arg_int, json_body,
    get_employee, EMP_SELECT,
    EMPLOYEE_STATUSES, EMAIL_RE, LEAVE_TYPES, LEAVE_STATUSES,
)

hr_bp = Blueprint("hr", __name__)

EMP_SELECT_WITH_CODE = EMP_SELECT.replace(
    "SELECT",
    "SELECT (SELECT a.employee_code FROM account a "
    "WHERE a.employee_id = e.employee_id LIMIT 1) AS employee_code,",
    1,
)

# --------------------------------------------------------------------------
# Employees
# --------------------------------------------------------------------------
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
    salary = to_money(pick("salary"), "Salary", required=True)

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


@hr_bp.get("/api/employees")
@role_required("admin", "hr")
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
        "LEFT JOIN departments d ON d.department_id = e.department_id "
        "LEFT JOIN positions p ON p.position_id = e.position_id" + where_sql,
        params,
    )["n"]
    pages = max((total + per_page - 1) // per_page, 1)
    page = min(page, pages)

    items = fetch_all(
        EMP_SELECT_WITH_CODE + where_sql + " ORDER BY e.employee_id LIMIT %s OFFSET %s",
        params + [per_page, (page - 1) * per_page],
    )
    return jsonify(items=items, page=page, per_page=per_page, total=total, pages=pages)


@hr_bp.get("/api/employees/<int:employee_id>")
@role_required("admin", "hr")
def read_employee(employee_id):
    emp = get_employee(employee_id)
    if not emp:
        raise ApiError("Employee not found.", 404)
    return jsonify(emp)


@hr_bp.post("/api/employees")
@role_required("admin", "hr")
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


@hr_bp.put("/api/employees/<int:employee_id>")
@role_required("admin", "hr")
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


@hr_bp.delete("/api/employees/<int:employee_id>")
@role_required("admin", "hr")
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
        cur.execute("DELETE FROM account WHERE employee_id = %s", (employee_id,))
        cur.execute("DELETE FROM employees WHERE employee_id = %s", (employee_id,))
        log_activity(cur, f"Deleted employee {emp['name']}")
    try:
        with db() as (_, cur):
            cur.execute("ALTER TABLE employees AUTO_INCREMENT = 1")
            cur.execute("ALTER TABLE account AUTO_INCREMENT = 1")
    except Exception as exc:
        print("[warning] could not reset AUTO_INCREMENT:", exc)
    return jsonify(message="Employee deleted.")

# --------------------------------------------------------------------------
# Payroll
# --------------------------------------------------------------------------
@hr_bp.get("/api/payroll")
@role_required("admin", "hr")
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


@hr_bp.post("/api/payroll")
@role_required("admin", "hr")
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
    LEFT JOIN departments d ON d.department_id = e.department_id
"""


@hr_bp.get("/api/leaves")
@role_required("admin", "hr")
def list_leaves():
    sql, params = LEAVE_SELECT, []
    status = clean(request.args.get("status"))
    if status:
        sql += " WHERE l.leave_status = %s"
        params.append(status)
    sql += " ORDER BY (l.leave_status = 'Pending') DESC, l.start_date DESC, l.leave_id DESC"
    return jsonify(fetch_all(sql, params))


@hr_bp.post("/api/leaves")
@role_required("admin", "hr")
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


@hr_bp.put("/api/leaves/<int:leave_id>/status")
@role_required("admin", "hr")
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


@hr_bp.delete("/api/leaves/<int:leave_id>")
@role_required("admin", "hr")
def delete_leave(leave_id):
    if not fetch_one("SELECT 1 AS ok FROM leave_requests WHERE leave_id = %s", (leave_id,)):
        raise ApiError("Leave request not found.", 404)
    with db() as (_, cur):
        cur.execute("DELETE FROM leave_requests WHERE leave_id = %s", (leave_id,))
    return jsonify(message="Leave request deleted.")