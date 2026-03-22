import requests
import json

# Test endpoint
url = 'http://localhost:5000/api/routes'
data = {
    'start': 'Redfern Station, Sydney',
    'end': 'Bondi Beach, Sydney',
    'vibe': 'scenic',
    'transport': 'car'
}

try:
    print("Testing API with Redfern Station -> Bondi Beach...")
    response = requests.post(url, json=data, timeout=15)
    print('Status:', response.status_code)
    result = response.json()
    if result.get('success'):
        print('✓ SUCCESS!')
        print(f"Routes generated: {len(result['routes'])} routes")
        print(f"Distance: {result['routes'][0]['distance']} km")
        print(f"Duration: {result['routes'][0]['duration']} min")
        print(f"\nFirst route:")
        print(f"  Name: {result['routes'][0]['name']}")
        print(f"  Description: {result['routes'][0]['description']}")
    else:
        print('Error:', result.get('error'))
except Exception as e:
    print(f'Connection Error: {e}')
