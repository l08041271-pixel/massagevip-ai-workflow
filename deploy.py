#!/usr/bin/env python3
"""
MassageVIP Automation - One-Command Deployment Script
Prepares the project for Render or Docker Compose deployment.
"""
import os
import sys
import subprocess
import secrets
import string


def generate_secret(length: int = 32) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def check_env_file() -> bool:
    if not os.path.exists(".env"):
        print("Creating .env from .env.example...")
        if os.path.exists(".env.example"):
            with open(".env.example") as f:
                content = f.read()
            # Auto-generate secrets
            content = content.replace("your-waha-api-key", generate_secret())
            content = content.replace("your-webhook-secret", generate_secret())
            with open(".env", "w") as f:
                f.write(content)
            print("  Created .env with generated secrets")
            return True
        else:
            print("  ERROR: .env.example not found")
            return False
    return True


def check_docker() -> bool:
    try:
        subprocess.run(["docker", "--version"], capture_output=True, check=True)
        subprocess.run(["docker-compose", "--version"], capture_output=True, check=True)
        print("  Docker and docker-compose found")
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("  Docker not found (optional for cloud deployment)")
        return True  # Not required for Render deployment


def check_git() -> bool:
    try:
        subprocess.run(["git", "--version"], capture_output=True, check=True)
        print("  Git found")
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("  Git not found (optional)")
        return True  # Not strictly required


def check_files() -> bool:
    required = [
        "main.py", "requirements.txt", "schema.sql", "render.yaml",
        "Dockerfile", "Dockerfile.waha", "docker-compose.yml",
        "webhook.py", "ai_orchestrator.py", "decision_engine.py",
        "actions.py", "crm.py", "idempotency.py", "middleware.py",
        "monitoring.py", "booking.py", "follow_up.py", "approval.py",
        "whatsapp_provider.py", "test_integration.py", "smoke_test.py",
    ]
    missing = [f for f in required if not os.path.exists(f)]
    if missing:
        print(f"  ERROR: Missing files: {missing}")
        return False
    print("  All required files present")
    return True


def init_git_repo() -> None:
    if not os.path.exists(".git"):
        print("Initializing git repository...")
        subprocess.run(["git", "init"], check=True)
        subprocess.run(["git", "add", "."], check=True)
        subprocess.run(["git", "commit", "-m", "Initial commit: MassageVIP Automation MVP"], check=True)
        print("  Git repository initialized")


def print_deployment_options() -> None:
    print("\n" + "=" * 60)
    print("DEPLOYMENT OPTIONS")
    print("=" * 60)
    print("\nOption A: Render Cloud (Recommended)")
    print("  1. Push this repo to GitHub")
    print("  2. Go to https://render.com → New → PostgreSQL")
    print("  3. Run: psql $DATABASE_URL -f schema.sql")
    print("  4. Go to https://render.com → New → Docker")
    print("     - Connect GitHub repo")
    print("     - Dockerfile: ./Dockerfile.waha")
    print("     - Name: waha")
    print("  5. Go to https://render.com → New → Worker")
    print("     - Connect GitHub repo")
    print("     - Build: pip install -r requirements.txt")
    print("     - Start: python main.py")
    print("     - Name: automation-worker")
    print("  6. Set env vars in Render dashboard (see .env.example)")
    print("  7. Open waha service URL, create session 'default'")
    print("  8. Scan QR with your WhatsApp phone")
    print("  9. Done - system is live!")
    
    print("\nOption B: Docker Compose (Local/VPS)")
    print("  1. cp .env.example .env")
    print("  2. Edit .env with your actual values")
    print("  3. docker-compose up -d")
    print("  4. Open http://localhost:3000")
    print("  5. Create session 'default' and scan QR")
    print("  6. Done - system is live!")
    
    print("\nOption C: Manual Python")
    print("  1. python -m venv .venv && source .venv/bin/activate")
    print("  2. pip install -r requirements.txt")
    print("  3. python main.py")
    print("  4. Open http://localhost:3000 (WAHA)")
    print("  5. Scan QR and send test message")


def main() -> int:
    print("=" * 60)
    print("MassageVIP Automation - Deployment Preparation")
    print("=" * 60)
    
    checks = [
        ("Checking .env file", check_env_file),
        ("Checking required files", check_files),
        ("Checking Docker (optional)", check_docker),
        ("Checking Git (optional)", check_git),
    ]
    
    all_ok = True
    for name, check in checks:
        print(f"\n{name}...")
        if not check():
            all_ok = False
    
    if all_ok:
        print("\n" + "=" * 60)
        print("DEPLOYMENT READY")
        print("=" * 60)
        init_git_repo()
        print_deployment_options()
        print("\n" + "=" * 60)
        print("QR CODE SETUP")
        print("=" * 60)
        print("\nTo get your QR code:")
        print("  1. Start WAHA: docker run -p 3000:3000 devlikeapro/waha")
        print("  2. Run: python3 generate_qr.py")
        print("  3. Scan waha_qr.png with WhatsApp")
        print("\nOR open http://localhost:3000 in browser")
        print("  1. POST /api/sessions with {'name': 'default'}")
        print("  2. GET /api/screenshot to see QR")
        print("  3. Scan with WhatsApp")
        return 0
    else:
        print("\n" + "=" * 60)
        print("DEPLOYMENT PREPARATION FAILED")
        print("=" * 60)
        print("Fix the errors above and try again.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
