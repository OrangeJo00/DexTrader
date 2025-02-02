import os
import pandas as pd
from datetime import datetime
import pytz

class InsufficientBalanceError(Exception):
    """Custom exception for insufficient balance"""
    pass

def generate_trade_confirmation():
    """
    Generate trade confirmation sheet from wallet and order data.
    
    Returns:
        str: Path to the generated CSV file
    Raises:
        InsufficientBalanceError: If order amount exceeds total balance
    """
    try:
        # Get current date in PST timezone
        pst = pytz.timezone('US/Pacific')
        current_datetime = datetime.now(pst)
        date_str = current_datetime.strftime('%Y%m%d_%H%M%S')
        
        # Define file paths using calculation_service directory
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        database_dir = os.path.join(base_dir, 'database')
        orders_path = os.path.join(database_dir, 'order_table.csv')
        wallet_path = os.path.join(database_dir, 'wallet_database.csv')
        
        # Create trade_confirmation directory if it doesn't exist
        trade_conf_dir = os.path.join(database_dir, 'trade_confirmation')
        os.makedirs(trade_conf_dir, exist_ok=True)
        
        # Define output path
        output_filename = f'trade_confirmation_sheet_{date_str}.csv'
        output_path = os.path.join(trade_conf_dir, output_filename)
        
        print(f"Reading input files...")
        
        # Read the input files
        if not os.path.exists(orders_path):
            raise FileNotFoundError(f"Order table not found: {orders_path}")
        if not os.path.exists(wallet_path):
            raise FileNotFoundError(f"Wallet database not found: {wallet_path}")
            
        orders_df = pd.read_csv(orders_path)
        wallet_df = pd.read_csv(wallet_path)
        
        print(f"Processing {len(orders_df)} orders for {len(wallet_df)} wallets...")

        # Calculate total balance for each from_token_address
        total_balances = wallet_df.groupby('from_token_address')['from_balance'].sum()

        # Create output dataframe
        output_rows = []

        for _, order in orders_df.iterrows():
            # Get total balance for this token
            if order['from_coin_address'] not in total_balances:
                print(f"Warning: No balance found for token {order['from_coin_address']}")
                continue
                
            total_balance = total_balances[order['from_coin_address']]
            
            # Validate order amount against total balance
            if order['coin_amount'] > total_balance:
                error_msg = (
                    f"Order amount ({order['coin_amount']}) exceeds total balance "
                    f"({total_balance}) for token {order['from_coin_address']}. "
                    f"Order cannot exceed 100% of total balance."
                )
                raise InsufficientBalanceError(error_msg)
            
            # Calculate percentage (multiply by 100 to show as percentage)
            pct_of_balance = (order['coin_amount'] / total_balance * 100)
            
            # Find matching wallets for this order
            matching_wallets = wallet_df[
                wallet_df['from_token_address'] == order['from_coin_address']
            ]
            
            for _, wallet in matching_wallets.iterrows():
                # Remove % sign from slippage if present
                slippage = order['slippage_pct'].replace('%', '') if isinstance(order['slippage_pct'], str) else order['slippage_pct']
                coin_amount = round(wallet['from_balance'] * pct_of_balance / 100, 6)
                row = {
                    'wallet_alias': wallet['wallet_alias'],
                    'wallet_address': wallet['wallet_address'],
                    'from_token_address': order['from_coin_address'],
                    'to_token_address': order['to_coin_address'],
                    'from_balance_before_execute': wallet['from_balance'],
                    'to_balance_before_execute': wallet['to_balance'],
                    'pct_of_balance': f"{round(pct_of_balance, 2)}%",
                    'coin_amount': coin_amount,
                    'delay_seconds': '5',
                    'slippage_in_pct': slippage,
                }
                output_rows.append(row)

        # Create final dataframe
        output_df = pd.DataFrame(output_rows)
        
        print(f"Generated {len(output_rows)} trade confirmations...")

        # Save to CSV
        output_df.to_csv(output_path, index=False)
        print(f"Saved trade confirmation to: {output_path}")
        
        return output_path

    except InsufficientBalanceError as e:
        print(f"Insufficient balance error: {e}")
        raise
    except Exception as e:
        print(f"Error generating trade confirmation: {e}")
        raise

if __name__ == "__main__":
    try:
        output_file = generate_trade_confirmation()
        print(f"Successfully generated: {output_file}")
    except InsufficientBalanceError as e:
        print(f"Failed due to insufficient balance: {e}")
    except Exception as e:
        print(f"Failed to generate trade confirmation: {e}")