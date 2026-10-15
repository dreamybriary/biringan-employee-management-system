# import tkinter as tk
# from tkinter import ttk, messagebox
# import customtkinter as ctk
# import mysql.connector

# ctk.set_appearance_mode("light")
# ctk.set_default_color_theme("blue")

# def connect_db():
#     return mysql.connector.connect(
#         host="localhost",
#         user="root",
#         password="password ng sql",
#         database="name ng data base"
#     )


# root = ctk.CTk()
# root.title("Biringan Employee Management System")
# root.geometry("1200x750")
# root.config(bg="#a7d7a9")

# employee_id = tk.StringVar()
# first_name = tk.StringVar()
# last_name = tk.StringVar()
# email = tk.StringVar()
# phone = tk.StringVar()
# status = tk.StringVar()
# salary = tk.StringVar()
# department_id = tk.StringVar()
# position_id = tk.StringVar()
# manager_id = tk.StringVar()



# def clear_fields():
#     employee_id.set("")
#     first_name.set("")
#     last_name.set("")
#     email.set("")
#     phone.set("")
#     status.set("Active")
#     salary.set("")
#     department_id.set("")
#     position_id.set("")
#     manager_id.set("")

# def fetch_data():
#     try:
#         con = connect_db()
#         cur = con.cursor()
        
#         cur.execute("""
#             SELECT employee_id, first_name, last_name, email,
#                 phone, status, salary, department_id,
#                 position_id, manager_id
#             FROM employees   
#                     """)
        
#         rows = cur.fetchall()
        
#         for item in employee_table.get_children():
#             employee_table.delete(item)
            
#         for rows in row:
#             employee_table.insert("", "end", values=rows)
            
#             cur.close()
#             con.close
            
#             fetch_data()
#             clear_fields()
            
#             messagebox.showinfo (
#                 "Success",
#                 "Employee added successfully!"
#             )
#     except mysql.connector.Error as err:
#         messagebox.showerror("Database Error", str(err))
        
        

# def add_employee():
#     if (
#         not first_name.get().strip()
#         or not last_name.get().strip()
#         or not email.get().strip()
#     ):
    
#         messagebox.showerror(
#             "Error",
#             "First Name, Last Name, and Email are required fields."
#         )
#         return
    
#     con = None
    
    
    
#     try:
#         con = connect_db()
#         cur = con.cursor()

#         cur.execute(
#             """
#             INSERT INTO employees
#             (first_name, last_name, email, phone, status, salary,
#              department_id, position_id, manager_id)
#             VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
#             """,
#             (
#                 first_name.get().strip(),
#                 last_name.get().strip(),
#                 email.get().strip(),
#                 phone.get().strip() or None,
#                 status.get(),
#                 salary.get().strip() or None,
#                 department_id.get() or None,
#                 position_id.get().strip() or None,
#                 manager_id.get().strip() or None
#             )
#         )

#         con.commit()
#         cur.close()
        
#         fetch_data()
#         clear_fields()
        
#         messagebox.showinfo(
#             "Success", "Employee added succesfully!" 
#         )

#     except mysql.connector.Error as err:
#         messagebox.showerror("Database Error", str(err))
        
#     finally:
#         if con and con_is_connected():
#             con.close()

# def select_employee():
    

# root.mainloop()
