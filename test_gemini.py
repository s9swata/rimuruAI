import urllib.request, json, sys, ssl
ssl._create_default_https_context = ssl._create_unverified_context

key = sys.argv[1] if len(sys.argv) > 1 else input("Paste Gemini API key: ").strip()
url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key={key}"
body = json.dumps({"contents": [{"parts": [{"text": "say hello in one word"}]}]}).encode()
req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})

try:
    with urllib.request.urlopen(req) as r:
        data = json.loads(r.read())
        print("✓ SUCCESS:", data["candidates"][0]["content"]["parts"][0]["text"].strip())
except urllib.error.HTTPError as e:
    body = e.read().decode()
    print(f"✗ HTTP {e.code}:", body)
except Exception as e:
    print("✗ ERROR:", e)
