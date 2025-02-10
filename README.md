# DexTraderV2

A decentralized trading application for Solana, supporting automated trading with multiple wallets.

## Prerequisites

- macOS 10.10+ (currently only supports macOS)
- Node.js 16+ and npm 8+
- Python 3.9.7 with Tk support

## Installation Steps

### 1. Python Setup

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

### 2. Node.js Setup
·
```bash
# Check versions
node --version  # Should be 16+
npm --version   # Should be 8+

# Install if needed
brew install node
```

### 3. Google Cloud Setup

```bash
# Install Google Cloud SDK
brew install google-cloud-sdk

# List available projects
gcloud projects list

# Set project
gcloud config set project YOUR_PROJECT_ID

# Login and authenticate
gcloud auth login
gcloud auth application-default login

# Verify setup
gcloud config list
```

### 4. Project Setup

```bash
# Clone repository
git clone https://github.com/OrangeJo00/DexTrader.git
cd DexTrader

# Copy environment template
cp .env.template .env

# Install Node.js dependencies
npm install
```

### Python Virtual Environment Setup

1. **Create New Environment**:
```bash
# Remove existing .venv if any
rm -rf .venv/

# Create new virtual environment
python3.9 -m venv .venv
```

2. **Activate Environment**:
```bash
# Activate
source .venv/bin/activate

# Verify activation (should show .venv path)
which python
# Expected: /path/to/project/.venv/bin/python
```

3. **Install Dependencies**:
```bash
# Upgrade pip first
pip install --upgrade pip

# Install requirements
pip install -r requirements.txt

# Verify installations
pip list
```

4. **Deactivate When Done**:
```bash
deactivate
```

Note: Always ensure virtual environment is activated when running the project:
```bash
# Check if needed
which python

# Activate if not in .venv
source .venv/bin/activate
```

## Environment Variables

Required in `.env`:
- `SOLANA_RPC_URL`: Solana RPC endpoint
- `SECRET_MANAGER_PROJECT_ID`: Google Cloud project ID
- `SECRET_MANAGER_SECRET_NAME`: Secret name for wallet keys
- `SECRET_MANAGER_VERSION`: Secret version (default: latest)

## Project Structure

```
DexTraderV2/
├── app.py                   # Main GUI application
├── trade_execute_service/   # Trading execution logic
├── wallet_service/         # Wallet management
├── calculation_service/    # Trading calculations
├── database/              # Trade data storage
└── node_modules/         # Node.js dependencies
```

## Maintenance

### Reauthenticate Google Cloud
```bash
# Clear credentials
gcloud auth revoke
gcloud auth application-default revoke

# Login again
gcloud auth login
gcloud auth application-default login
```

### Reinstall Python Dependencies
```bash
rm -rf .venv/
python3.9 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Reinstall Node.js Dependencies
```bash
rm -rf node_modules package-lock.json
npm cache clean --force
npm install
npm run build
npm run start
```

### Update the secret in google cloud secret manager

in console, go to secret manager, click on the secret, click on the version, click on the edit, and update the secret.

### Update the secret in the .env file

update the secret in the .env file with the new secret's name; version is always latest.

## Usage

```bash
python app.py
```

## Important Notes

- Logs: `~/Desktop/DexTraderV2_logs/`
- Trade data: `database/`
- Never commit `.env`
- Keep wallet keys secure
