import os
import json
from datetime import datetime, timedelta
from django.shortcuts import render
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.conf import settings
import requests
from dotenv import load_dotenv

load_dotenv()


OPENAI_REALTIME_URL = "https://api.openai.com/v1/realtime"



def ai_assistant(request):
    return render(request, 'core/index.html')


# Create your views here.
@csrf_exempt
def webrtc_signal(request):
    """Secure WebRTC signaling endpoint that proxies to OpenAI"""
    if request.method != 'POST':
        return JsonResponse({'error': 'Method not allowed'}, status=405)

    api_key = getattr(settings, 'OPENAI_API_KEY', os.environ.get('OPENAI_API_KEY'))
    if not api_key:
        return JsonResponse({'error': 'OpenAI API key not configured'}, status=500)

    try:
        try:
            request_data = json.loads(request.body.decode('utf-8'))
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON in request body'}, status=400)

        sdp_offer = request_data.get('sdp')
        session_params = request_data.get('session_params', {})
        
        if not sdp_offer:
            return JsonResponse({'error': 'SDP offer not provided in request body'}, status=400)

        model = session_params.get('model', 'gpt-4o-realtime-preview-2024-12-17')
        speed = session_params.get('speed')

        # Configure the standard API URL for realtime
        api_url = f"{OPENAI_REALTIME_URL}?model={model}"
        if speed:
            api_url += f"&speed={speed}"

        response = requests.post(
            api_url,
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/sdp',
                'OpenAI-Beta': 'realtime=v1'
            },
            data=sdp_offer,
            timeout=30
        )

        response.raise_for_status()

        sdp_answer = response.text
        
        return JsonResponse({
            'sdp': sdp_answer,
            'session_data': session_params
        })

    except requests.exceptions.HTTPError as http_err:
        error_content = "Unknown error"
        try:
            error_content = http_err.response.json() if http_err.response else str(http_err)
        except json.JSONDecodeError:
            error_content = http_err.response.text if http_err.response else str(http_err)
        return JsonResponse({'error': 'OpenAI API error', 'details': error_content},
                            status=(http_err.response.status_code if http_err.response else 500))
    except Exception as e:
        return JsonResponse({'error': 'Server error', 'details': str(e)}, status=500)

@csrf_exempt
def save_standup_data(request):
    """Save standup data to day-specific JSON file"""
    if request.method != 'POST':
        return JsonResponse({'error': 'Method not allowed'}, status=405)

    try:
        # Parse the incoming data
        standup_data = json.loads(request.body.decode('utf-8'))
        
        # Get today's date
        today = datetime.now()
        year = str(today.year)
        month = str(today.month).zfill(2)
        day = str(today.day).zfill(2)
        
        # Create directory structure
        data_dir = os.path.join(settings.BASE_DIR, 'data', year, month)
        os.makedirs(data_dir, exist_ok=True)
        
        # File path for today's data
        file_path = os.path.join(data_dir, f'{day}.json')
        
        # Save data to today's file
        with open(file_path, 'w', encoding='utf-8') as file:
            json.dump(standup_data, file, indent=2, ensure_ascii=False)
        
        return JsonResponse({
            'success': True,
            'message': f'Standup data saved for {year}-{month}-{day}',
            'file_path': file_path
        })
        
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON data'}, status=400)
    except Exception as e:
        return JsonResponse({'error': f'Server error: {str(e)}'}, status=500)

@csrf_exempt
def get_previous_day_data(request):
    """Get previous day's data from day-specific JSON file"""
    if request.method != 'GET':
        return JsonResponse({'error': 'Method not allowed'}, status=405)

    try:
        # Get yesterday's date
        yesterday = datetime.now() - timedelta(days=1)
        year = str(yesterday.year)
        month = str(yesterday.month).zfill(2)
        day = str(yesterday.day).zfill(2)
        
        # File path for yesterday's data
        file_path = os.path.join(settings.BASE_DIR, 'data', year, month, f'{day}.json')
        
        if os.path.exists(file_path):
            with open(file_path, 'r', encoding='utf-8') as file:
                data = json.load(file)
            return JsonResponse(data, safe=False)
        else:
            return JsonResponse([], safe=False)
            
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON in file'}, status=500)
    except Exception as e:
        return JsonResponse({'error': f'Server error: {str(e)}'}, status=500)

@csrf_exempt
def get_specific_day_data(request):
    """Get data for a specific date"""
    if request.method != 'GET':
        return JsonResponse({'error': 'Method not allowed'}, status=405)

    try:
        # Get date from query parameters
        year = request.GET.get('year')
        month = request.GET.get('month')
        day = request.GET.get('day')
        
        if not all([year, month, day]):
            return JsonResponse({'error': 'Missing date parameters'}, status=400)
        
        # File path for specific date
        file_path = os.path.join(settings.BASE_DIR, 'data', year, month, f'{day}.json')
        
        if os.path.exists(file_path):
            with open(file_path, 'r', encoding='utf-8') as file:
                data = json.load(file)
            return JsonResponse(data, safe=False)
        else:
            return JsonResponse([], safe=False)
            
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON in file'}, status=500)
    except Exception as e:
        return JsonResponse({'error': f'Server error: {str(e)}'}, status=500)