from django.urls import path
from . import views

app_name = 'voice_assistant'

urlpatterns = [
    path('', views.ai_assistant, name='ai_assistant'),
    path('webrtc-signal/', views.webrtc_signal, name='webrtc_signal'),
    path('save-standup-data/', views.save_standup_data, name='save_standup_data'),
    path('get-previous-day-data/', views.get_previous_day_data, name='get_previous_day_data'),
    path('get-specific-day-data/', views.get_specific_day_data, name='get_specific_day_data'),
] 