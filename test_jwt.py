import sys
import os

# Set env vars
os.environ['LIVEKIT_URL'] = 'wss://test.livekit.cloud'
os.environ['LIVEKIT_API_KEY'] = 'testkey'
os.environ['LIVEKIT_API_SECRET'] = 'testsecret'

# Import the function
sys.path.insert(0, '.')
from backend.routes.livekit import generate_livekit_jwt

try:
    token = generate_livekit_jwt('testkey', 'testsecret', 'testuser', 'Test User', 'room-1')
    print('Token generated successfully!')
    print('Token:', token[:100])
except Exception as e:
    print('Error:', e)
    import traceback
    traceback.print_exc()