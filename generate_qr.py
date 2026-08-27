#!/usr/bin/env python3
"""
Generate QR code for WAHA session setup.
Two modes:
1. Fetch QR from running WAHA instance (recommended)
2. Generate a template QR for manual setup
"""
import os
import sys
import urllib.request
import urllib.error

def fetch_waha_qr(base_url: str, session: str = "default", api_key: str = "") -> bytes:
    """Fetch QR code PNG from WAHA /api/screenshot endpoint."""
    url = f"{base_url.rstrip('/')}/api/screenshot?session={session}"
    headers = {}
    if api_key:
        headers["X-Api-Key"] = api_key
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = r.read()
            if data.startswith(b"\x89PNG"):
                return data
            raise RuntimeError(f"Unexpected response: {data[:200]}")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {body}") from exc
    except Exception as exc:
        raise RuntimeError(f"Failed to fetch QR: {exc}") from exc


def generate_template_qr(phone: str) -> bytes:
    """Generate a QR code template for WhatsApp link."""
    try:
        import qrcode
    except ImportError:
        # Fallback: create a simple text-based "QR" placeholder
        text = f"https://wa.me/{phone}?text=Hello%20from%20MassageVIP"
        return text.encode()
    
    qr = qrcode.QRCode(version=1, box_size=10, border=5)
    qr.add_data(f"https://wa.me/{phone}")
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    import io
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def main() -> int:
    print("MassageVIP Automation - WAHA QR Generator")
    print("=" * 50)
    
    # Try to fetch from WAHA first
    base_url = os.environ.get("WAHA_BASE_URL", "http://localhost:3000")
    api_key = os.environ.get("WAHA_API_KEY", "")
    session = os.environ.get("WAHA_SESSION", "default")
    
    print(f"\n[1/2] Attempting to fetch QR from WAHA at {base_url}")
    try:
        png = fetch_waha_qr(base_url, session, api_key)
        output = "waha_qr.png"
        with open(output, "wb") as f:
            f.write(png)
        print(f"  SUCCESS: QR saved to {output}")
        print(f"  Open {output} to scan with WhatsApp")
        return 0
    except Exception as exc:
        print(f"  Could not fetch from WAHA: {exc}")
    
    # Fallback to template
    print("\n[2/2] Generating template QR")
    phone = os.environ.get("OWNER_WHATSAPP", "966500000000").replace("whatsapp:", "").replace("+", "")
    output = "whatsapp_qr_template.png"
    
    try:
        png = generate_template_qr(phone)
        if isinstance(png, bytes) and png.startswith(b"\x89PNG"):
            with open(output, "wb") as f:
                f.write(png)
            print(f"  SUCCESS: Template QR saved to {output}")
        else:
            # Text fallback
            output = "whatsapp_link.txt"
            with open(output, "w") as f:
                f.write(f"Open this link on your phone to start WhatsApp session:\n{png.decode()}")
            print(f"  Template link saved to {output}")
    except Exception as exc:
        print(f"  Failed to generate template: {exc}")
        return 1
    
    print("\n" + "=" * 50)
    print("NEXT STEPS:")
    print("1. Start WAHA: docker run -p 3000:3000 devlikeapro/waha")
    print("2. Run this script again to fetch the real QR")
    print("3. Or open http://localhost:3000 in browser")
    print("4. Create session 'default' and scan QR")
    print("=" * 50)
    return 0


if __name__ == "__main__":
    sys.exit(main())
