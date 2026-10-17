-- bri badeg

CREATE DATABASE biri_go;
USE biri_go;



CREATE TABLE departments (
    department_id    INT AUTO_INCREMENT PRIMARY KEY,
    dept_name             VARCHAR(100) NOT NULL UNIQUE,
    head_employee_id INT NULL
);

SELECT account_email, account_role FROM account;
CREATE TABLE positions (
    position_id   INT AUTO_INCREMENT PRIMARY KEY,
    title         VARCHAR(100) NOT NULL,
    department_id INT NOT NULL,
    FOREIGN KEY (department_id) REFERENCES departments(department_id),
    UNIQUE (title, department_id)
);


CREATE TABLE employees (
    employee_id   INT AUTO_INCREMENT PRIMARY KEY,
    first_name    VARCHAR(50)  NOT NULL,
    last_name     VARCHAR(50)  NOT NULL,
    email         VARCHAR(100) NOT NULL UNIQUE,
    phone         VARCHAR(20),
    stat        ENUM('Active','On Leave','Resigned','Terminated') NOT NULL DEFAULT 'Active',
    salary        DECIMAL(10,2),
    department_id INT NOT NULL,
    position_id   INT NOT NULL,
    manager_id    INT NULL,
    FOREIGN KEY (department_id) REFERENCES departments(department_id),
    FOREIGN KEY (position_id)   REFERENCES positions(position_id),
    FOREIGN KEY (manager_id)    REFERENCES employees(employee_id)
);

ALTER TABLE employees
  ADD COLUMN middle_name VARCHAR(50) NULL AFTER first_name,
  ADD COLUMN suffix VARCHAR(20) NULL AFTER last_name,
  ADD COLUMN sex ENUM('Male','Female') NULL,
  ADD COLUMN birthday DATE NULL;

ALTER TABLE employees
    MODIFY department_id INT NULL,
    MODIFY position_id   INT NULL;

CREATE TABLE account(
    account_id       INT AUTO_INCREMENT PRIMARY KEY,
    account_email    VARCHAR(100) UNIQUE NOT NULL,
    account_password VARCHAR(255) NOT NULL,
    account_role     ENUM('employee','hr','admin','owner') NOT NULL DEFAULT 'employee',
    employee_id      INT NULL,
    FOREIGN KEY (employee_id) REFERENCES employees(employee_id)
);

ALTER TABLE account
  ADD COLUMN employee_code VARCHAR(11) NULL UNIQUE AFTER account_id;

-- Give your existing admin an ID so you can still log in
UPDATE account SET employee_code = 'biri-000000'
WHERE account_email = 'admin@biringan.com';

INSERT INTO account (account_email, account_password, account_role)
VALUES ('admin@biringan.com', 'scrypt:32768:8:1$gMncLpSd2W3NQh7v$8b670d9f0890342701187831502232b791ec3ba35d3b7485e3684281b6f2b24ee7f558de96460b468f872f85306825af891f4426e0537d4816bf7b60355ab9f4', 'admin');

ALTER TABLE departments
    ADD FOREIGN KEY (head_employee_id) REFERENCES employees(employee_id);


CREATE TABLE attendance (
    attendance_id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id   INT NOT NULL,
    work_date     DATE NOT NULL,
    time_in       TIME,
    time_out      TIME,
    FOREIGN KEY (employee_id) REFERENCES employees(employee_id),
    UNIQUE (employee_id, work_date)
);

CREATE TABLE leave_requests (
    leave_id    INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    leave_type  ENUM('Vacation','Sick','Emergency','Other') NOT NULL,
    start_date  DATE NOT NULL,
    end_date    DATE NOT NULL,
    leave_status      ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
    FOREIGN KEY (employee_id) REFERENCES employees(employee_id)
);


CREATE TABLE payroll (
    payroll_id   INT AUTO_INCREMENT PRIMARY KEY,
    employee_id  INT NOT NULL,
    pay_period   DATE NOT NULL,
    gross_pay    DECIMAL(10,2) NOT NULL,
    deductions   DECIMAL(10,2) NOT NULL DEFAULT 0,
    net_pay      DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (employee_id) REFERENCES employees(employee_id)
);


INSERT INTO departments (dept_name) VALUES
    ('Executive Leadership'),
    ('Core Operations & Delivery'),
    ('Sales & Marketing'),
    ('Engineering & IT Product'),
    ('Human Resources & Admin'),
    ('Customer Success'),
    ('Finance & Accounting');

INSERT INTO positions (title, department_id) VALUES
    ('Chief Executive Officer', 1),
    ('Chief Technology Officer', 1),
    ('Chief Operations Officer', 1),
    ('Operations Director', 2),
    ('Team Lead', 2),
    ('Dispatcher', 2),
    ('Warehouse Staff', 2),
    ('Marketing Director', 3),
    ('Account Manager', 3),
    ('Sales Representative', 3),
    ('Content/SEO Specialist', 3),
    ('Engineering VP', 4),
    ('Product Manager', 4),
    ('Software Engineer', 4),
    ('QA Tester', 4),
    ('HR Manager', 5),
    ('Recruiter', 5),
    ('Payroll Specialist', 5),
    ('Office Administrator', 5),
    ('Customer Success Manager', 6),
    ('Account Specialist', 6),
    ('Finance Director', 7),
    ('Senior Accountant', 7);
    
SELECT account_email, employee_code, account_role FROM account;
SELECT employee_id, first_name, department_id, position_id FROM employees;
-- SELECT d.dept_name, COUNT(e.employee_id) AS headcount
-- FROM departments d
-- LEFT JOIN employees e ON e.department_id = d.department_id AND e.status = 'Active'
-- GROUP BY d.department_id, d.dept_name;