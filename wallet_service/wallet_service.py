import asyncio
import pandas as pd
import numpy as np
from pathlib import Path
from typing import Dict, Set
import os
import sys

# Add the parent directory to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from wallet_service.wallet import Wallet  # Now use the full path
from decimal import Decimal
from datetime import datetime

# Configure pandas to display full precision
pd.set_option('display.float_format', lambda x: '{:.6f}'.format(x))

# Get the absolute path to the database directory
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATABASE_DIR = os.path.join(BASE_DIR, 'database')

# Constants
SOL_MINT = "So11111111111111111111111111111111111111112"

# file path of the initial wallet database
INITIAL_DATABASE_PATH = os.path.join(DATABASE_DIR, 'wallet_database_initial.csv')

# file path of the working wallet database
WORKING_DATABASE_PATH = os.path.join(DATABASE_DIR, 'wallet_database.csv')

# Create database directory if it doesn't exist
os.makedirs(DATABASE_DIR, exist_ok=True)

async def get_token_or_sol_balance(wallet: Wallet, token_address: str) -> Decimal:
    """
    Get balance for either SOL or SPL token.

    Args:
        wallet (Wallet): Wallet instance
        token_address (str): Token mint address or SOL_MINT

    Returns:
        Decimal: Balance with 6 decimal places
    """
    try:
        if token_address == SOL_MINT:
            balance = await wallet.get_balance()
            return Decimal(str(balance)).quantize(Decimal('0.000000'))
        else:
            response = await wallet.get_token_balance(token_address)
            return Decimal(response['uiAmountString']).quantize(Decimal('0.000000'))
    except Exception as e:
        print(f"Error getting balance for token {token_address}: {e}")
        return Decimal('0.000000')

async def load_wallets(
    update_mode: str = "update_all",
    csv_path: str = None
) -> pd.DataFrame:
    """
    Load and filter wallet database based on update mode.

    Args:
        update_mode (str): Either "update_all" or "update_selected"
        csv_path (str, optional): Override default CSV path

    Returns:
        pd.DataFrame: Filtered wallet database ready for processing
    """
    try:
        # Set default CSV path based on update mode if not provided
        if csv_path is None:
            if update_mode == "update_selected":
                csv_path = WORKING_DATABASE_PATH
            else:
                csv_path = INITIAL_DATABASE_PATH

        print(f"Loading from: {csv_path}")
        
        if not os.path.exists(csv_path):
            raise FileNotFoundError(f"Database file not found: {csv_path}")

        # Read the CSV file
        df = pd.read_csv(csv_path)
        total_rows = len(df)
        print(f"Loaded {total_rows} rows from database")

        if update_mode == "update_selected":
            # Convert 'selected' column to string and handle NaN values
            df['selected'] = df['selected'].fillna('').astype(str)
            
            # Filter for selected rows only (case-insensitive)
            df_filtered = df[df['selected'].str.lower().isin(['yes', 'true', '1'])].copy()
            selected_rows = len(df_filtered)
            
            if selected_rows == 0:
                print("No rows selected for update")
            else:
                print(f"Found {selected_rows} selected rows to update")
            
            return df_filtered
        else:
            # Process all rows
            print("Processing all rows in database")
            return df

    except Exception as e:
        print(f"Error loading database: {e}")
        raise

async def update_wallet_balances(df: pd.DataFrame) -> pd.DataFrame:
    """
    Update wallet balances for the provided dataframe.

    Args:
        df (pd.DataFrame): Wallet database to process

    Returns:
        pd.DataFrame: Updated wallet database with current balances
    """
    try:
        # Initialize balance columns if they don't exist
        for col in ['from_balance', 'to_balance']:
            if col not in df.columns:
                df[col] = None
                
        # Initialize or ensure lastUpdatedOn column exists
        if 'lastUpdatedOn' not in df.columns:
            df['lastUpdatedOn'] = None

        # Process each row
        for index, row in df.iterrows():
            if pd.isna(row['wallet_address']):
                continue

            try:
                print(f"\nProcessing wallet {row['wallet_alias']} ({row['wallet_address']})")
                wallet = Wallet(row['wallet_address'])
                
                # Get from_token balance
                if pd.notna(row['from_token_address']):
                    from_balance = await get_token_or_sol_balance(wallet, row['from_token_address'])
                    df.at[index, 'from_balance'] = str(from_balance)
                    print(f"From token ({row['from_token_address']}) balance: {from_balance}")

                # Get to_token balance
                if pd.notna(row['to_token_address']):
                    to_balance = await get_token_or_sol_balance(wallet, row['to_token_address'])
                    df.at[index, 'to_balance'] = str(to_balance)
                    print(f"To token ({row['to_token_address']}) balance: {to_balance}")
                
                # Update timestamp with quotes to preserve format
                df.at[index, 'lastUpdatedOn'] = f'"{datetime.now().strftime("%Y-%m-%d %H:%M:%S")}"'
                
            except Exception as e:
                print(f"Error processing wallet {row['wallet_alias']}: {e}")
                continue

        return df

    except Exception as e:
        print(f"Error updating balances: {e}")
        raise

async def save_updated_database(df: pd.DataFrame, output_path: str = WORKING_DATABASE_PATH):
    """
    Save the updated database and print a summary.
    """
    try:
        # Convert balance columns to string format with 6 decimal places
        for col in ['from_balance', 'to_balance']:
            df[col] = df[col].apply(lambda x: '{:.6f}'.format(float(x)) if pd.notna(x) else x)

        # Save updated database without index and quote all fields
        df.to_csv(output_path, index=False, float_format='%.6f', quoting=1)  # quoting=1 means QUOTE_ALL
        print(f"\nSaved updated database to {output_path}")
        
        # Print summary
        print("\nFinal balances:")
        for _, row in df.iterrows():
            if pd.notna(row['wallet_address']):
                print(f"\nWallet: {row['wallet_alias']} ({row['wallet_address']})")
                if pd.notna(row['from_token_address']):
                    print(f"  From token ({row['from_token_address']}): {row['from_balance']}")
                if pd.notna(row['to_token_address']):
                    print(f"  To token ({row['to_token_address']}): {row['to_balance']}")
                # Remove quotes for display
                last_updated = row['lastUpdatedOn'].strip('"') if isinstance(row['lastUpdatedOn'], str) else row['lastUpdatedOn']
                print(f"  Last updated: {last_updated}")
    
    except Exception as e:
        print(f"Error saving database: {e}")
        raise

async def main():
    """Example usage"""
    try:
        # Example with default paths
        wallets_df = await load_wallets(update_mode="update_selected")
        # Or with custom path
        # wallets_df = await load_wallets(update_mode="update_all", csv_path="custom/path.csv")
        
        # Update balances
        updated_df = await update_wallet_balances(wallets_df)
        
        # Save and print results
        await save_updated_database(updated_df)
                
    except Exception as e:
        print(f"Error in main: {e}")

if __name__ == "__main__":
    asyncio.run(main())