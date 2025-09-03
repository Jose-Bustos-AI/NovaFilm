# VideoAI - AI-Powered Video Generation Platform

A full-stack SaaS platform for AI video generation using Kie.ai's Veo3 Fast model with OpenAI-powered prompt refinement.

## Features

- 🎬 **AI Video Generation**: Create stunning videos from text descriptions using Kie.ai Veo3 Fast
- 🤖 **AI Chat Assistant**: OpenAI-powered chatbot that refines prompts for optimal video generation
- 👤 **User Authentication**: Secure authentication with Replit Auth (OpenID Connect)
- 📊 **Real-time Job Tracking**: Monitor video generation progress with live updates
- 🎯 **Video Gallery**: Browse, preview, and download your generated videos
- 📱 **Responsive Design**: Works perfectly on desktop and mobile devices
- 🌙 **Dark Theme**: Professional dark-themed interface optimized for video content

## Tech Stack

### Frontend
- **React 18** with TypeScript
- **Tailwind CSS** for styling
- **shadcn/ui** components
- **React Query** for data fetching
- **Wouter** for routing
- **Video.js** for video playback

### Backend
- **Express.js** with TypeScript
- **PostgreSQL** with Neon serverless
- **Drizzle ORM** for database operations
- **Replit Auth** (OpenID Connect)

### AI & External APIs
- **OpenAI GPT-5** for chat and prompt refinement
- **Kie.ai Veo3 Fast** for video generation

## Setup Instructions

### 1. Environment Variables

Copy `.env.example` to `.env` and configure the following variables in Replit Secrets:

```env
# OpenAI API Key
OPENAI_API_KEY=your_openai_api_key_here

# Kie.ai Configuration
KIE_API_BASE=https://api.kie.ai/api/v1
KIE_API_KEY=your_kie_api_key_here

# Database (Neon PostgreSQL)
DATABASE_URL=postgresql://username:password@hostname:port/database

# Application URL (auto-configured by Replit)
APP_BASE_URL=https://your-replit-url.replit.dev

# Session Secret (provided by Replit)
SESSION_SECRET=your_session_secret_here
