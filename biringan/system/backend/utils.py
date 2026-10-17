import re
from datetime import date, datetime, timedelta
from decimal import Decimal

from flask import request
from flask.json.provider import DefaultJSONProvider

from db import fetch_one

# --------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------
EMPLOYEE_STATUSES = ("Active", "On Leave", "Resigned", "Terminated")
LEAVE_TYPES = ("Vacation", "Sick", "Emergency", "Other")
LEAVE_STATUSES = ("Pending", "Approved", "Rejected")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# --------------------------------------------------------------------------
# JSON provider (Decimal, dates and timedelta become JSON-friendly)
# --------------------------------------------------------------------------
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


# --------------------------------------------------------------------------
# Errors and validation helpers
# --------------------------------------------------------------------------
class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


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
# Employee lookup (shared by HR, owner and employee routes)
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
    LEFT JOIN departments d ON d.department_id = e.department_id
    LEFT JOIN positions   p ON p.position_id   = e.position_id
"""


def get_employee(employee_id):
    return fetch_one(EMP_SELECT + " WHERE e.employee_id = %s", (employee_id,))