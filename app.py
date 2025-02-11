import os
import sys
import traceback
import logging
from datetime import datetime
import pandas as pd
from glob import glob

# Set up logging in a more accessible location
home_dir = os.path.expanduser('~')
log_dir = os.path.join(home_dir, 'Desktop', 'DexTraderV2_logs')
os.makedirs(log_dir, exist_ok=True)

log_file = os.path.join(log_dir, f'app_error_{datetime.now().strftime("%Y%m%d_%H%M%S")}.log')
logging.basicConfig(
    filename=log_file,
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

# Log system information
logging.info(f"Python Version: {sys.version}")
logging.info(f"Platform: {sys.platform}")
logging.info(f"Current Directory: {os.getcwd()}")
logging.info(f"Script Location: {os.path.abspath(__file__)}")

try:
    # Log the contents of the Resources directory
    if getattr(sys, 'frozen', False):
        resources_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'Resources')
        logging.info(f"Resources Path: {resources_path}")
        if os.path.exists(resources_path):
            logging.info("Resources directory contents:")
            for root, dirs, files in os.walk(resources_path):
                logging.info(f"Directory: {root}")
                for d in dirs:
                    logging.info(f"  Dir: {d}")
                for f in files:
                    logging.info(f"  File: {f}")
except Exception as e:
    logging.error(f"Error listing resources: {e}")

# Add the application directory to Python path
if getattr(sys, 'frozen', False):
    # If the application is run as a bundle
    application_path = sys._MEIPASS
    logging.info(f"Running as frozen app from: {application_path}")
else:
    # If the application is run from a Python interpreter
    application_path = os.path.dirname(os.path.abspath(__file__))
    logging.info(f"Running in development from: {application_path}")

# Add application path to system path
sys.path.insert(0, application_path)

from datetime import datetime
import pytz
import tkinter as tk
from tkinter import ttk, messagebox, scrolledtext
import asyncio
import threading
import subprocess
import platform

from wallet_service.wallet_service import load_wallets, update_wallet_balances, save_updated_database, WORKING_DATABASE_PATH
from calculation_service.calculation import generate_trade_confirmation

def open_file(filepath):
    """Open file with default application based on operating system"""
    try:
        if platform.system() == 'Darwin':       # macOS
            subprocess.call(('open', filepath))
        elif platform.system() == 'Windows':     # Windows
            os.startfile(filepath)
        else:                                   # Linux variants
            subprocess.call(('xdg-open', filepath))
    except Exception as e:
        print(f"Error opening file: {e}")

def get_latest_trade_confirmation_file():
    """Get the most recent trade confirmation file"""
    base_dir = os.path.dirname(WORKING_DATABASE_PATH)
    trade_conf_dir = os.path.join(base_dir, 'trade_confirmation')
    
    if not os.path.exists(trade_conf_dir):
        return None
        
    files = [f for f in os.listdir(trade_conf_dir) if f.startswith('trade_confirmation_sheet_')]
    if not files:
        return None
        
    latest_file = max(files, key=lambda x: os.path.getctime(os.path.join(trade_conf_dir, x)))
    return os.path.join(trade_conf_dir, latest_file)

class AutoTradeApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Auto Trade App")
        
        # Configure main window
        self.root.geometry("1200x800")
        self.root.configure(padx=20, pady=20)
        
        # Create main container
        main_container = ttk.Frame(root)
        main_container.pack(expand=True, fill='both')
        
        # Configure grid weights
        main_container.grid_columnconfigure(0, weight=1)
        main_container.grid_columnconfigure(1, weight=1)
        main_container.grid_columnconfigure(2, weight=1)
        main_container.grid_rowconfigure(0, weight=1)
        
        # Create three sections
        self.create_wallet_section(main_container)
        self.create_generate_section(main_container)
        self.create_execute_section(main_container)

        # Add class variable for orders file path
        self.ORDERS_FILE_PATH = os.path.join(os.path.dirname(WORKING_DATABASE_PATH), 'generated_orders.csv')

    def create_wallet_section(self, parent):
        """Create wallet management section"""
        wallet_frame = ttk.LabelFrame(parent, text="Wallet Management", padding=10)
        wallet_frame.grid(row=0, column=0, padx=5, pady=5, sticky='nsew')
        
        # Update buttons
        self.update_all_button = ttk.Button(
            wallet_frame,
            text="Update All Wallet Balances",
            command=lambda: self.run_async_task("update_all")
        )
        self.update_all_button.pack(pady=5, fill='x')
        
        self.update_selected_button = ttk.Button(
            wallet_frame,
            text="Update Selected Wallet Balances",
            command=lambda: self.run_async_task("update_selected")
        )
        self.update_selected_button.pack(pady=5, fill='x')
        
        # Auto-open checkbox
        self.auto_open_var = tk.BooleanVar(value=True)
        self.auto_open_check = ttk.Checkbutton(
            wallet_frame,
            text="Auto-open CSV after update",
            variable=self.auto_open_var
        )
        self.auto_open_check.pack(pady=5)
        
        # Progress indicator
        self.status_label = ttk.Label(wallet_frame, text="Ready")
        self.status_label.pack(pady=5)
        
        self.progress = ttk.Progressbar(
            wallet_frame,
            mode='indeterminate',
            length=300
        )
        self.progress.pack(pady=5)

    def create_generate_section(self, parent):
        """Create order generation section"""
        generate_frame = ttk.LabelFrame(parent, text="Confirmation", padding=10)
        generate_frame.grid(row=0, column=1, padx=5, pady=5, sticky='nsew')
        
        # Open order.csv button
        ttk.Button(
            generate_frame,
            text="Open order.csv",
            command=self.open_order_csv
        ).pack(pady=5, fill='x')
        
        # Generate button
        ttk.Button(
            generate_frame,
            text="Generate Trade Confirmation",
            command=self.generate_trade_confirmation
        ).pack(pady=5, fill='x')
        
        # Progress indicator
        self.trade_conf_status_label = ttk.Label(generate_frame, text="Ready")
        self.trade_conf_status_label.pack(pady=5)
        
        self.trade_conf_progress = ttk.Progressbar(
            generate_frame,
            mode='indeterminate',
            length=300
        )
        self.trade_conf_progress.pack(pady=5)
        
        # Auto-open checkbox for trade confirmation
        self.auto_open_trade_conf_var = tk.BooleanVar(value=True)
        self.auto_open_trade_conf_check = ttk.Checkbutton(
            generate_frame,
            text="Auto-open trade confirmation after generation",
            variable=self.auto_open_trade_conf_var
        )
        self.auto_open_trade_conf_check.pack(pady=5)

    def create_execute_section(self, parent):
        """Create order execution section"""
        execute_frame = ttk.LabelFrame(parent, text="Execute Orders", padding=10)
        execute_frame.grid(row=0, column=2, padx=5, pady=5, sticky='nsew')
        
        # Configure grid weights for the frame
        execute_frame.grid_columnconfigure(0, weight=1)
        execute_frame.grid_rowconfigure(2, weight=1)
        
        # Buttons frame
        buttons_frame = ttk.Frame(execute_frame)
        buttons_frame.grid(row=0, column=0, pady=5, sticky='ew')
        
        # Check if trade confirmation exists
        latest_conf = get_latest_trade_confirmation_file()
        initial_state = 'normal' if latest_conf else 'disabled'
        
        self.start_execution_button = ttk.Button(
            buttons_frame,
            text="Start Execution",
            command=self.start_execution,
            state=initial_state
        )
        self.start_execution_button.pack(pady=5, fill='x')
        
        # Add log display section
        log_label = ttk.Label(execute_frame, text="Execution Log:")
        log_label.grid(row=1, column=0, pady=(10,0), sticky='w')
        
        self.log_display = scrolledtext.ScrolledText(
            execute_frame,
            height=20,
            wrap=tk.WORD,
            font=('Courier', 9)
        )
        self.log_display.grid(row=2, column=0, pady=5, sticky='nsew')

    def generate_trade_confirmation(self):
        """Generate trade confirmation and open file"""
        try:
            self.trade_conf_status_label.config(text="Generating trade confirmation...")
            self.trade_conf_progress.start()
            
            # Run calculation in a separate thread
            thread = threading.Thread(
                target=self._run_calculation
            )
            thread.start()
            
        except Exception as e:
            self.trade_conf_progress.stop()
            self.trade_conf_status_label.config(text="Ready")
            messagebox.showerror("Error", f"Failed to generate trade confirmation: {str(e)}")

    def _run_calculation(self):
        """Run calculation in background thread"""
        try:
            # Import and run calculation
            from calculation_service.calculation import generate_trade_confirmation
            latest_file = generate_trade_confirmation()
            
            if latest_file and self.auto_open_trade_conf_var.get():
                self.root.after(100, lambda: open_file(latest_file))
            
            # Store success message in a variable before passing to lambda
            success_msg = "Trade confirmation generated successfully!"
            self.root.after(0, lambda: messagebox.showinfo("Success", success_msg))
            
        except Exception as e:
            # Store error message in a variable before passing to lambda
            error_msg = f"Failed to generate trade confirmation: {str(e)}"
            self.root.after(0, lambda: messagebox.showerror("Error", error_msg))
        finally:
            self.root.after(0, self._calculation_complete)

    def _calculation_complete(self):
        """Update UI after calculation completes"""
        self.trade_conf_progress.stop()
        self.trade_conf_status_label.config(text="Ready")
        # Enable start execution button when trade confirmation is generated
        self.start_execution_button.state(['!disabled'])

    def start_execution(self):
        """Start trade execution by running trade.ts"""
        try:
            # Get latest trade confirmation file
            latest_conf = get_latest_trade_confirmation_file()
            if not latest_conf:
                messagebox.showerror("Error", "No trade confirmation file found")
                return

            # Enable start execution button and disable start button
            self.start_execution_button.state(['disabled'])

            # Run trade.ts using npm start
            process = subprocess.Popen(
                ['npm', 'start'],
                cwd=os.path.dirname(os.path.abspath(__file__)),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,  # Merge stderr into stdout
                text=True,
                bufsize=1,  # Line buffering
                universal_newlines=True
            )

            # Start a thread to monitor the process
            threading.Thread(target=self._monitor_execution, args=(process,), daemon=True).start()

        except Exception as e:
            messagebox.showerror("Error", f"Failed to start execution: {str(e)}")
            self.start_execution_button.state(['!disabled'])

    def _monitor_execution(self, process):
        """Monitor the execution process and update UI accordingly"""
        try:
            while True:
                output = process.stdout.readline()
                if output:
                    self.root.after(0, self.update_log, output.strip())
                if process.poll() is not None:
                    break
            
            # Read any remaining output
            stdout, stderr = process.communicate()
            if stdout:
                self.root.after(0, self.update_log, stdout)
            if stderr:
                self.root.after(0, self.update_log, f"Error: {stderr}")
            
            # Process completed
            self.root.after(0, self._execution_complete, process.returncode, stdout, stderr)
        except Exception as e:
            self.root.after(0, self.update_log, f"Monitoring error: {str(e)}")
            self.root.after(0, self._execution_complete, -1, "", str(e))

    def _execution_complete(self, return_code, stdout, stderr):
        """Handle execution completion"""
        self.start_execution_button.state(['!disabled'])

        if return_code == 0:
            messagebox.showinfo("Success", "Trade execution completed successfully")

        else:
            error_msg = stderr if stderr else stdout
            messagebox.showerror("Error", f"Trade execution failed:\n{error_msg}")
        self.open_latest_trade_results()

        # Show updating wallet balance message in log
        self.update_log("\n" + "="*50)
        self.update_log("Starting wallet balance update...")
        self.update_log("="*50 + "\n")
        # Automatically run update selected wallet balance without opening CSV
        self.run_async_task("update_selected", auto_open_csv=False)

    def run_async_task(self, update_mode, auto_open_csv=True):
        """Start async task in a separate thread"""
        self.disable_buttons()
        self.progress.start()
        self.status_label.config(text="Processing...")
        
        thread = threading.Thread(
            target=lambda: asyncio.run(self.process_wallets(update_mode, auto_open_csv))
        )
        thread.start()

    def disable_buttons(self):
        """Disable buttons during processing"""
        self.update_all_button.state(['disabled'])
        self.update_selected_button.state(['disabled'])

    def enable_buttons(self):
        """Enable buttons after processing"""
        self.update_all_button.state(['!disabled'])
        self.update_selected_button.state(['!disabled'])

    async def process_wallets(self, update_mode, auto_open_csv=False):
        """Process wallets and update GUI
        Args:
            update_mode: Mode for updating wallets
            auto_open_csv: Whether to automatically open CSV after update (default: True)
        """
        try:
            self.status_label.config(text="Loading wallets...")
            wallets_df = await load_wallets(update_mode=update_mode)
            
            if len(wallets_df) == 0:
                self.root.after(0, self.on_task_complete, "No wallets to update!")
                return
            
            self.status_label.config(text="Updating balances...")
            updated_df = await update_wallet_balances(wallets_df)
            
            self.status_label.config(text="Saving results...")
            await save_updated_database(updated_df)
            
            # Remove delay for file opening
            if auto_open_csv:
                self.root.after(0, lambda: open_file(WORKING_DATABASE_PATH))
            self.root.after(0, self.on_task_complete, "Update selected wallet balances successfully!")
            
        except Exception as e:
            error_message = f"Error: {str(e)}"
            self.root.after(0, self.on_task_complete, error_message, True)

    def on_task_complete(self, message, is_error=False):
        """Update GUI after task completion"""
        self.progress.stop()
        self.enable_buttons()
        self.status_label.config(text="Ready")
        
        if is_error:
            messagebox.showerror("Error", message)
        else:
            # Add completion message to log
            self.update_log("\n" + "="*50)
            self.update_log("Wallet balance update completed!")
            self.update_log("="*50 + "\n")
            messagebox.showinfo("Success", message)

    def open_order_csv(self):
        """Open the order.csv file using the default system application"""
        order_csv_path = os.path.join(os.path.dirname(WORKING_DATABASE_PATH), 'order_table.csv')
        try:
            if sys.platform.startswith('darwin'):  # macOS
                subprocess.run(['open', order_csv_path])
            elif sys.platform.startswith('win32'):  # Windows
                os.startfile(order_csv_path)
            else:  # Linux
                subprocess.run(['xdg-open', order_csv_path])
        except Exception as e:
            messagebox.showerror("Error", f"Could not open order.csv: {str(e)}")

    def update_log(self, message):
        """Update the log display with new message"""
        self.log_display.insert(tk.END, f"{message}\n")
        self.log_display.see(tk.END)  # Auto-scroll to bottom

    def open_latest_trade_results(self):
        """Open the latest trade_results CSV file using the default system application"""
        try:
            # Get the latest trade results file from the correct subdirectory
            results_dir = os.path.join("database", "trade_results")
            pattern = os.path.join(results_dir, "trade_results_*.csv")
            files = glob(pattern)
            
            if not files:
                messagebox.showwarning("Warning", "No trade results file found")
                return
                
            latest_file = max(files, key=os.path.getctime)
            
            # Open file based on platform
            if sys.platform.startswith('darwin'):  # macOS
                subprocess.run(['open', latest_file])
            elif sys.platform.startswith('win32'):  # Windows
                os.startfile(latest_file)
            else:  # Linux
                subprocess.run(['xdg-open', latest_file])
                
        except Exception as e:
            messagebox.showerror("Error", f"Could not open trade results file: {str(e)}")

def main():
    try:
        # Log startup information
        logging.info("Application starting...")
        logging.info(f"Python version: {sys.version}")
        logging.info(f"Current working directory: {os.getcwd()}")
        logging.info(f"System path: {sys.path}")
        
        root = tk.Tk()
        app = AutoTradeApp(root)
        root.mainloop()
    except Exception as e:
        # Log the full error traceback
        logging.error("Fatal error in main loop:", exc_info=True)
        error_msg = f"Application Error: {str(e)}\n\nPlease check logs/app_error.log for details."
        
        try:
            # Try to show error in GUI
            import tkinter.messagebox as messagebox
            messagebox.showerror("Error", error_msg)
        except:
            # If GUI fails, print to console
            print(error_msg)
            print(traceback.format_exc())
        
        # Keep console window open
        if not sys.stdout.isatty():
            input("Press Enter to close...")

if __name__ == "__main__":
    main()