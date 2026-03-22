from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import json
import requests
from dotenv import load_dotenv
import google.generativeai as genai
import googlemaps
import random

load_dotenv()

app = Flask(__name__)
CORS(app)

# Configuration
GOOGLE_GEMINI_API_KEY = os.getenv("GOOGLE_GEMINI_API_KEY")
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY")
SPOTIFY_API_KEY = os.getenv("SPOTIFY_API_KEY")

# Initialize Google APIs
if GOOGLE_GEMINI_API_KEY:
    genai.configure(api_key=GOOGLE_GEMINI_API_KEY)

gmaps = None
if GOOGLE_MAPS_API_KEY:
    gmaps = googlemaps.Client(key=GOOGLE_MAPS_API_KEY)

# Vibe to characteristics mapping
VIBE_CHARACTERISTICS = {
    "calm": {
        "keywords": ["peaceful", "quiet", "slow", "reflective", "serene"],
        "route_preference": "quiet streets, parks, low traffic zones",
        "music_genre": "ambient, lo-fi, classical",
        "emoji": "🌿"
    },
    "scenic": {
        "keywords": ["beautiful", "views", "greenery", "water", "nature"],
        "route_preference": "waterfront, parks, scenic viewpoints, greenery",
        "music_genre": "indie, folk, acoustic",
        "emoji": "🌄"
    },
    "fast": {
        "keywords": ["quick", "quick", "fastest", "speed", "efficient"],
        "route_preference": "main roads, highways, minimum stops",
        "music_genre": "electronic, EDM, high-energy",
        "emoji": "⚡"
    },
    "fun": {
        "keywords": ["fun", "party", "exciting", "vibrant", "lively"],
        "route_preference": "busy areas, city streets, activity hubs, restaurants",
        "music_genre": "pop, upbeat, dance",
        "emoji": "🎉"
    },
    "quiet": {
        "keywords": ["silent", "peaceful", "still", "tranquil", "muted"],
        "route_preference": "residential areas, libraries, parks, nature trails",
        "music_genre": "ambient, minimalist, meditation",
        "emoji": "🤫"
    }
}

def classify_vibe(vibe_text):
    """Classify user vibe input into predefined categories"""
    vibe_lower = vibe_text.lower()
    
    for vibe, data in VIBE_CHARACTERISTICS.items():
        if vibe in vibe_lower:
            return vibe
        for keyword in data["keywords"]:
            if keyword in vibe_lower:
                return vibe
    
    # Default to most similar using simple logic
    return "scenic"

def convert_transport_mode(transport_from_frontend):
    """Convert frontend transport IDs to Google Maps API modes"""
    mode_mapping = {
        'car': 'driving',
        'walking': 'walking',
        'bike': 'bicycling',
        'transit': 'transit',
        'driving': 'driving',
        'bicycling': 'bicycling'
    }
    return mode_mapping.get(transport_from_frontend, 'driving')

def generate_ai_routes(start_loc, end_loc, vibe, transport):
    """Generate route variations using Google Gemini AI"""
    vibe_classified = classify_vibe(vibe)
    vibe_data = VIBE_CHARACTERISTICS[vibe_classified]
    
    prompt = f"""
    Generate 3 unique route descriptions for navigation from {start_loc} to {end_loc}.
    
    User Vibe: {vibe} (classified as: {vibe_classified})
    Transport Mode: {transport}
    Route Preference: {vibe_data['route_preference']}
    
    For each route, provide a JSON object with:
    {{
        "name": "descriptive route name",
        "description": "why this matches the vibe",
        "style": "route characteristics",
        "stops": [
            {{
                "name": "Attraction or Stop Name",
                "description": "Detailed explanation of why this stop fits the vibe perfectly"
            }}
        ],
        "vibe_explanation": "short explanation of how this matches the mood"
    }}
    
    Return ONLY a valid JSON array. Be creative and specific to the vibe!
    Routes should be realistic and practical. Aim for exactly 3-4 stops per route.
    """
    
    try:
        # Use Google Gemini directly
        if not GOOGLE_GEMINI_API_KEY:
            raise ValueError("Google Gemini API key not set")
        
        model = genai.GenerativeModel('gemini-2.0-flash')
        response = model.generate_content(prompt)
        
        if response.text:
            content = response.text
            # Parse JSON from response
            try:
                import re
                # Extract JSON array from response
                json_match = re.search(r'\[.*\]', content, re.DOTALL)
                if json_match:
                    routes = json.loads(json_match.group())
                    return routes[:3]  # Return max 3 routes
            except Exception as parse_error:
                print(f"JSON Parse Error: {parse_error}")
                print(f"Response: {content}")
        
        # Fallback routes if AI fails
        print("Warning: Failed to parse Gemini response, using fallback")
        return generate_fallback_routes(vibe_classified, start_loc, end_loc)
        
    except Exception as e:
        print(f"Google Gemini Error: {e}")
        return generate_fallback_routes(vibe_classified, start_loc, end_loc)

def generate_fallback_routes(vibe, start_loc, end_loc):
    """Generate fallback routes when AI is unavailable"""
    base_routes = {
        "calm": [
            {
                "name": "Peaceful Park Route",
                "description": "Meanders through parks and quiet residential areas",
                "style": "Low traffic, tree-lined streets, nature areas",
                "stops": [
                    {"name": "City Park", "description": "A quiet oasis filled with ancient trees."},
                    {"name": "Botanical Gardens", "description": "Perfect spot to reflect amongst beautiful flora."},
                    {"name": "Riverside Trail", "description": "Listen to the gentle flowing water."}
                ],
                "vibe_explanation": "This route prioritizes peace and quiet, avoiding busy streets"
            },
            {
                "name": "Zen Pathway",
                "description": "Uses back roads and scenic byways",
                "style": "Quiet neighborhoods, scenic overlooks",
                "stops": [
                    {"name": "Nature Reserve", "description": "Unplug and watch the local wildlife."},
                    {"name": "Peaceful Lake View", "description": "A secluded viewpoint over the still water."},
                    {"name": "Garden District", "description": "Quiet streets with beautifully manicured lawns."}
                ],
                "vibe_explanation": "Perfect for a reflective journey with minimal traffic"
            }
        ],
        "scenic": [
            {
                "name": "Sunset Riverside Route",
                "description": "Follows waterfront with scenic vistas",
                "style": "Waterfront, viewpoints, greenery",
                "stops": [
                    {"name": "River Path", "description": "A winding trail right alongside the water."},
                    {"name": "Scenic Overlook", "description": "The best place to watch the sun go down."},
                    {"name": "Waterfront Park", "description": "Open grass with a picturesque backdrop."}
                ],
                "vibe_explanation": "Maximizes beautiful views and natural scenery"
            },
            {
                "name": "Nature's Loop",
                "description": "Passes through green spaces and natural landmarks",
                "style": "Parks, trails, natural features",
                "stops": [
                    {"name": "Forest Park", "description": "Deep greenery that makes you forget you are near a city."},
                    {"name": "Canyon View", "description": "A dramatic natural geographical formation."},
                    {"name": "Nature Trail", "description": "A dirt path flanked by wildflowers."}
                ],
                "vibe_explanation": "Celebrates natural beauty at every turn"
            }
        ],
        "fast": [
            {
                "name": "Express Highway Route",
                "description": "Direct path using main thoroughfares",
                "style": "Main roads, highways, efficient",
                "stops": [
                    {"name": "Downtown Hub", "description": "The fastest entry point to the city core."},
                    {"name": "Business District", "description": "Straight roads and high-speed corridors."}
                ],
                "vibe_explanation": "Fastest route with minimal detours"
            },
            {
                "name": "Quick City Route",
                "description": "Optimized for speed through urban areas",
                "style": "Major streets, quick intersections",
                "stops": [
                    {"name": "City Center", "description": "A straight shot through the main avenues."}
                ],
                "vibe_explanation": "Gets you there efficiently"
            }
        ],
        "fun": [
            {
                "name": "Entertainment District Route",
                "description": "Passes vibrant areas with restaurants and shops",
                "style": "Busy streets, activity hubs, nightlife",
                "stops": [
                    {"name": "Restaurant Row", "description": "Smell the incredible food from a dozen different spots."},
                    {"name": "Shopping District", "description": "Bright windows and bustling crowds."},
                    {"name": "Entertainment Hub", "description": "Street performers and neon lights."}
                ],
                "vibe_explanation": "Routes through exciting, lively areas"
            },
            {
                "name": "Culture & Vibes Route",
                "description": "Through trendy neighborhoods and cultural spots",
                "style": "Urban energy, diverse neighborhoods",
                "stops": [
                    {"name": "Art District", "description": "Vibrant murals painting the streets."},
                    {"name": "Trendy Neighborhood", "description": "Hip cafes and boutique pop-ups."},
                    {"name": "Cultural Center", "description": "The heartbeat of the local scene."}
                ],
                "vibe_explanation": "Discover exciting places along the way"
            }
        ],
        "quiet": [
            {
                "name": "Silent Escape Route",
                "description": "Avoids all major traffic and noise",
                "style": "Quiet residential, minimal traffic",
                "stops": [
                    {"name": "Peaceful Neighborhood", "description": "Classic architecture with zero through-traffic."},
                    {"name": "Library District", "description": "A silent block dedicated to deep focus."},
                    {"name": "Meditation Garden", "description": "A hidden courtyard tucked away from the noise."}
                ],
                "vibe_explanation": "Pure silence and tranquility throughout"
            }
        ]
    }
    
    routes = base_routes.get(vibe, base_routes["scenic"])
    return routes[:3]  # Return up to 3 routes

def get_route_coordinates(start_loc, end_loc, mode='driving', vibe='scenic'):
    """Get coordinates and actual route - PRIMARY: Google Maps (fallback: None)"""
    try:
        # Get geocoding for both locations first (REAL DATA ONLY)
        start_coords = geocode_location(start_loc)
        end_coords = geocode_location(end_loc)
        
        if not start_coords or not end_coords:
            raise ValueError("Could not find coordinates for given locations")
        
        # Strictly use Google Maps
        if gmaps:
            try:
                directions_result = gmaps.directions(start_loc, end_loc, mode=mode, alternatives=True)
                if directions_result:
                    routes_data = []
                    for route in directions_result:
                        leg = route['legs'][0]
                        points = []
                        if 'overview_polyline' in route and 'points' in route['overview_polyline']:
                            decoded = googlemaps.convert.decode_polyline(route['overview_polyline']['points'])
                            points = [[p['lat'], p['lng']] for p in decoded]
                        else:
                            # Keep start point
                            points.append([leg['start_location']['lat'], leg['start_location']['lng']])
                            # Add all steps
                            for step in leg['steps']:
                                points.append([step['end_location']['lat'], step['end_location']['lng']])
                        
                        routes_data.append({
                            "distance": round(leg['distance']['value'] / 1000, 2),
                            "duration": round(leg['duration']['value'] / 60),
                            "coordinates": points,
                            "start_address": leg['start_address'],
                            "end_address": leg['end_address']
                        })
                        
                    # If we don't have enough routes to provide variety, generate fake-ish Google Maps routes using waypoints
                    import math
                    if len(routes_data) < 3:
                        leg = directions_result[0]['legs'][0]
                        start_coord = leg['start_location']
                        end_coord = leg['end_location']
                        mid_lat = (start_coord['lat'] + end_coord['lat']) / 2
                        mid_lng = (start_coord['lng'] + end_coord['lng']) / 2
                        d_lat = end_coord['lat'] - start_coord['lat']
                        d_lng = end_coord['lng'] - start_coord['lng']
                        length = math.sqrt(d_lat**2 + d_lng**2) or 1
                        
                        offsets = [0.02, -0.02, 0.04, -0.04]  # 0.02 degrees is ~2.2km, a reasonable diversion
                        
                        for offset in offsets:
                            if len(routes_data) >= 3:
                                break
                            
                            wp_lat = mid_lat + (-d_lng / length) * offset
                            wp_lng = mid_lng + (d_lat / length) * offset
                            wp = f"{wp_lat},{wp_lng}"
                            
                            try:
                                extra_directions = gmaps.directions(start_loc, end_loc, mode=mode, waypoints=[wp])
                                if extra_directions:
                                    extra_route = extra_directions[0]
                                    total_distance = sum(l['distance']['value'] for l in extra_route['legs'])
                                    total_duration = sum(l['duration']['value'] for l in extra_route['legs'])
                                    
                                    points = []
                                    if 'overview_polyline' in extra_route and 'points' in extra_route['overview_polyline']:
                                        decoded = googlemaps.convert.decode_polyline(extra_route['overview_polyline']['points'])
                                        points = [[p['lat'], p['lng']] for p in decoded]
                                        
                                    routes_data.append({
                                        "distance": round(total_distance / 1000, 2),
                                        "duration": round(total_duration / 60),
                                        "coordinates": points,
                                        "start_address": extra_route['legs'][0]['start_address'],
                                        "end_address": extra_route['legs'][-1]['end_address']
                                    })
                            except Exception:
                                pass
                                
                    return routes_data
                else:
                    raise ValueError(f"No route found between {start_loc} and {end_loc}")
            except Exception as gm_error:
                print(f"Google Maps error: {gm_error}")
                raise
        
        # No valid API available
        raise ValueError("Google Maps API is not configured: Please check your GOOGLE_MAPS_API_KEY in .env")
        
    except ValueError:
        raise  # Re-raise ValueError as-is for client feedback
    except Exception as e:
        print(f"Route coordinate error: {str(e)}")
        raise ValueError(f"Failed to generate route: {str(e)}")

def geocode_location(location):
    """Helper to get coordinates for a location - REAL DATA ONLY"""
    if not gmaps:
        raise ValueError("Google Maps API not configured. Please set GOOGLE_MAPS_API_KEY in .env")
    
    try:
        result = gmaps.geocode(location)
        if result:
            coords = result[0]['geometry']['location']
            return {'lat': coords['lat'], 'lng': coords['lng']}
        else:
            raise ValueError(f"Location '{location}' not found. Please check the address and try again.")
    except Exception as e:
        raise ValueError(f"Failed to geocode '{location}': {str(e)}")

def generate_playlist(vibe, duration_minutes):
    """Generate Spotify-style playlist suggestions based on vibe"""
    vibe_classified = classify_vibe(vibe)
    vibe_data = VIBE_CHARACTERISTICS[vibe_classified]
    
    playlists = {
        "calm": [
            {"title": "Lo-Fi Study Session", "tracks": 15, "genre": "lo-fi"},
            {"title": "Ambient Soundscapes", "tracks": 12, "genre": "ambient"},
            {"title": "Peaceful Piano", "tracks": 14, "genre": "classical"}
        ],
        "scenic": [
            {"title": "Indie Folk Favorites", "tracks": 18, "genre": "folk"},
            {"title": "Acoustic Chill", "tracks": 16, "genre": "acoustic"},
            {"title": "Nature Sounds Mix", "tracks": 20, "genre": "ambient/nature"}
        ],
        "fast": [
            {"title": "High Energy EDM", "tracks": 20, "genre": "edm"},
            {"title": "Electronic Beats", "tracks": 22, "genre": "electronic"},
            {"title": "Pump It Up", "tracks": 19, "genre": "edm/pop"}
        ],
        "fun": [
            {"title": "Party Classics", "tracks": 25, "genre": "pop/dance"},
            {"title": "Upbeat Pop Mix", "tracks": 23, "genre": "pop"},
            {"title": "Dance All Night", "tracks": 24, "genre": "dance"}
        ],
        "quiet": [
            {"title": "Meditation & Mindfulness", "tracks": 14, "genre": "ambient"},
            {"title": "Peaceful Silence", "tracks": 12, "genre": "minimalist"},
            {"title": "Zen Garden", "tracks": 13, "genre": "ambient"}
        ]
    }
    
    return playlists.get(vibe_classified, playlists["scenic"])

def get_attractions_for_vibe(vibe, num_attractions=5):
    """Get attraction suggestions based on vibe"""
    vibe_classified = classify_vibe(vibe)
    
    attractions_by_vibe = {
        "calm": [
            "🧘 Meditation Parks",
            "🌳 Botanical Gardens", 
            "🏞️ Nature Reserves",
            "🏛️ Museums & Galleries",
            "☕ Quiet Cafes",
            "🌊 Lakeside Trails",
            "📚 Libraries",
            "🕉️ Temples & Peaceful Places"
        ],
        "scenic": [
            "🏔️ Mountain Overlooks",
            "🌅 Viewpoints",
            "🌲 Scenic Forests",
            "🏞️ National Parks",
            "🌸 Flower Gardens",
            "🌊 Coastal Routes",
            "🎨 Artistic Districts",
            "📷 Photo Spots"
        ],
        "fast": [
            "⚡ Shopping Malls",
            "🏃 Sports Centers",
            "🚗 Racing Tracks",
            "🏬 Market Districts",
            "🍔 Food Courts",
            "🎯 Amusement Parks",
            "🏢 Business Centers",
            "🎮 Gaming Arcades"
        ],
        "fun": [
            "🎭 Entertainment Districts",
            "🎪 Amusement Parks",
            "🎤 Live Music Venues",
            "🍕 Trendy Restaurants",
            "🛍️ Shopping Districts",
            "🎨 Art Galleries",
            "🎬 Movie Theaters",
            "🎡 Theme Parks"
        ],
        "quiet": [
            "🧘‍♀️ Meditation Spaces",
            "📖 Reading Nooks",
            "🌙 Night Markets",
            "🕯️ Candlelit Spaces",
            "🌲 Silent Forests",
            "🏞️ Secluded Areas",
            "🌃 Quiet Neighborhoods",
            "☪️ Sacred Places"
        ]
    }
    
    attractions = attractions_by_vibe.get(vibe_classified, attractions_by_vibe["scenic"])
    return attractions[:num_attractions]

@app.route('/api/geocode', methods=['POST'])
def geocode():
    """Geocode location string to coordinates using Google Maps API"""
    data = request.json
    location = data.get('location')
    
    if not location:
        return jsonify({"error": "No location provided"}), 400
    
    try:
        if gmaps:
            # Use Google Maps Geocoding API
            result = gmaps.geocode(location)
            if result:
                coords = result[0]['geometry']['location']
                return jsonify({
                    "lat": coords['lat'],
                    "lng": coords['lng'],
                    "formatted_address": result[0]['formatted_address']
                })
        else:
            print("Warning: Google Maps API not available, using mock data")
    except Exception as e:
        print(f"Geocoding Error: {e}")
    
    # Fallback mock locations
    mock_locations = {
        "central park": {"lat": 40.7829, "lng": -73.9654, "formatted_address": "Central Park, New York, NY, USA"},
        "eiffel tower": {"lat": 48.8584, "lng": 2.2945, "formatted_address": "Eiffel Tower, Paris, France"},
        "statue of liberty": {"lat": 40.6892, "lng": -74.0445, "formatted_address": "Statue of Liberty, New York, NY, USA"},
        "big ben": {"lat": 51.4975, "lng": -0.1357, "formatted_address": "Big Ben, London, UK"},
        "colosseum": {"lat": 41.8902, "lng": 12.4924, "formatted_address": "Colosseum, Rome, Italy"},
        "times square": {"lat": 40.7580, "lng": -73.9855, "formatted_address": "Times Square, New York, NY, USA"},
        "sydney opera house": {"lat": -33.8568, "lng": 151.2153, "formatted_address": "Sydney Opera House, Sydney, Australia"}
    }
    
    location_lower = location.lower()
    if location_lower in mock_locations:
        return jsonify(mock_locations[location_lower])
    
    # Return NYC as default
    return jsonify({"lat": 40.7128, "lng": -74.0060, "formatted_address": "New York, NY, USA"})

@app.route('/api/routes', methods=['POST', 'GET'])
def get_routes():
    """Get vibe-based routes - REAL DATA ONLY"""
    try:
        # Handle both POST (JSON) and GET (query params)
        if request.method == 'POST':
            data = request.json or {}
        else:
            data = request.args.to_dict()
        
        start = data.get('start')
        end = data.get('end')
        vibe = data.get('vibe', 'scenic')
        transport = data.get('transport', 'car')
        
        # Convert frontend transport mode to Google Maps API mode
        transport_mode = convert_transport_mode(transport)
        
        # Validate inputs
        if not start or not start.strip():
            return jsonify({"success": False, "error": "Start location is required"}), 400
        if not end or not end.strip():
            return jsonify({"success": False, "error": "End location is required"}), 400
        
        # Generate AI routes
        ai_routes = generate_ai_routes(start, end, vibe, transport)
        
        # Get actual routing info with vibe consideration (REAL DATA ONLY)
        routing_infos = get_route_coordinates(start, end, transport_mode, vibe)
        
        # Enhance routes with actual data
        for i, route in enumerate(ai_routes):
            routing_info = routing_infos[i % len(routing_infos)]
            route["distance"] = routing_info["distance"]
            route["duration"] = routing_info["duration"]
            route["transport"] = transport
            route["coordinates"] = routing_info["coordinates"]
            
            # Generate a Google Maps link for sharing
            try:
                start_coords = geocode_location(start)
                end_coords = geocode_location(end)
                route["google_maps_url"] = f"https://www.google.com/maps/dir/?api=1&origin={start_coords['lat']},{start_coords['lng']}&destination={end_coords['lat']},{end_coords['lng']}&travelmode={transport_mode}"
            except Exception as map_err:
                print(f"Warning: Could not generate Google Maps URL: {map_err}")
                route["google_maps_url"] = "https://www.google.com/maps"
        
        return jsonify({
            "success": True,
            "routes": ai_routes,
            "vibe": vibe,
            "transport": transport
        })
    except ValueError as ve:
        # Specific error from API calls (location not found, etc.)
        return jsonify({"success": False, "error": str(ve)}), 400
    except Exception as e:
        # General error
        print(f"Routes Error: {str(e)}")
        return jsonify({"success": False, "error": f"Failed to generate routes: {str(e)}"}), 500

@app.route('/api/playlist', methods=['POST'])
def get_playlist():
    """Get vibe-based playlist"""
    try:
        data = request.json
        vibe = data.get('vibe', 'scenic')
        duration = data.get('duration', 30)
        
        playlists = generate_playlist(vibe, duration)
        
        return jsonify({
            "success": True,
            "playlists": playlists,
            "vibe": vibe
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/surprise', methods=['POST'])
def surprise_route():
    """Generate random surprise route"""
    try:
        data = request.json
        start = data.get('start')
        transport = data.get('transport', 'car')
        
        # Random vibe selection
        vibes = list(VIBE_CHARACTERISTICS.keys())
        random_vibe = random.choice(vibes)
        
        # Random destination
        destinations = ["Central Park", "Botanical Gardens", "Waterfront", "Downtown", "Countryside"]
        random_destination = random.choice(destinations)
        
        ai_routes = generate_ai_routes(start, random_destination, random_vibe, transport)
        routing_infos = get_route_coordinates(start, random_destination)
        
        for i, route in enumerate(ai_routes):
            routing_info = routing_infos[i % len(routing_infos)]
            route["distance"] = routing_info["distance"]
            route["duration"] = routing_info["duration"]
            route["transport"] = transport
            route["coordinates"] = routing_info["coordinates"]
        
        return jsonify({
            "success": True,
            "routes": ai_routes,
            "destination": random_destination,
            "vibe": random_vibe,
            "message": f"🎲 Surprise! Explore with a {random_vibe} vibe!"
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/export', methods=['POST'])
def export_route():
    """Export route for sharing"""
    try:
        data = request.json
        route_data = data.get('route')
        
        # Generate shareable link (in production, create shorter URL)
        share_link = f"https://viberoute.app/shared/{random.randint(100000, 999999)}"
        
        return jsonify({
            "success": True,
            "shareLink": share_link,
            "googleMapsUrl": f"https://maps.google.com/?saddr={route_data.get('start')}&daddr={route_data.get('end')}",
            "message": "Route exported! Share your vibe-based route with friends."
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "healthy"})

if __name__ == '__main__':
    app.run(debug=True, port=5000)
