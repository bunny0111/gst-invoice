from django.urls import path

from . import views

urlpatterns = [
    path("api/auth/login/", views.LoginView.as_view()),
    path("api/auth/logout/", views.LogoutView.as_view()),
    path("api/auth/me/", views.MeView.as_view()),
    path("api/auth/forgot-password/", views.ForgotPasswordView.as_view()),
    path("api/auth/reset-password/", views.ResetPasswordView.as_view()),
    path("api/profile/", views.ProfileView.as_view()),
    path("api/profile/logo/", views.LogoView.as_view()),
    path("api/logo/<int:pk>/", views.logo_image),
]
