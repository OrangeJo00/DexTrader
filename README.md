# DexTraderV2

A decentralized trading application for Solana, supporting automated trading with multiple wallets.

## Prerequisites

- macOS 10.10+ (currently only supports macOS)
- Node.js 16+ and npm 8+
- Python 3.9.7 with Tk support

## Installation Steps

### 1. Install Python 3.9 with Tk Support

```bash
# Install Homebrew if needed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Python 3.9 and Tk
brew install tcl-tk
brew install python@3.9
brew install python-tk@3.9

# Verify installation
python3.9 --version
python3.9 -c "import tkinter; print('Tk installation successful')"
```

### 2. Install Node.js and npm

```bash
# Check if installed
node --version  # Should be 16+
npm --version   # Should be 8+

# Install if needed
brew install node
```

### 3. Clone Repository

```bash
git clone https://github.com/OrangeJo00/DexTrader.git
cd DexTrader
```

### 4. Configure Environment

```bash
# Copy environment template
cp .env.template .env
```

Required environment variables:
- `SOLANA_RPC_URL`: Your Solana RPC endpoint
- `SECRET_MANAGER_PROJECT_ID`: Google Cloud project ID
- `SECRET_MANAGER_SECRET_NAME`: Secret name for wallet keys
- `SECRET_MANAGER_VERSION`: Version of the secret (default: latest)

### 5. Install Dependencies

```bash
# Install Node.js dependencies
npm install

# Install Python dependencies
pip3.9 install -r requirements.txt
```

## Project Structure

```
DexTraderV2/
├── app.py                    # Main GUI application
├── trade_execute_service/    # Trading execution logic
├── wallet_service/          # Wallet management
├── calculation_service/     # Trading calculations
├── database/               # Trade data storage
└── node_modules/          # Node.js dependencies
```

## Usage

```bash
# Run the application
python3.9 app.py
```

## Important Notes

- Logs are created in `~/Desktop/DexTraderV2_logs/`
- Trade data is stored in `database/`
- Never commit `.env` file to version control
- Keep your wallet keys secure
