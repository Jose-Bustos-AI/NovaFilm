# VideoAI - AI-Powered Video Generation Platform

## Overview

VideoAI is a full-stack SaaS platform that enables users to generate professional videos from text descriptions using AI technology. The platform combines Kie.ai's Veo3 Fast video generation model with OpenAI's GPT-5 for intelligent prompt refinement and chat assistance. Users can create videos through an intuitive interface, track generation progress in real-time, and manage their video library through a comprehensive gallery system. The application features secure authentication, responsive design, and a dark-themed interface optimized for video content creation workflows.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
The frontend is built with **React 18** and **TypeScript**, utilizing a component-based architecture with modern hooks and context patterns. The application uses **Wouter** for lightweight client-side routing and **Tailwind CSS** with **shadcn/ui** components for consistent styling. State management is handled through **React Query** for server state and local React state for UI interactions. The interface follows a dashboard pattern with a fixed sidebar navigation and multiple views (Dashboard, Gallery) for different user workflows.

### Backend Architecture
The backend uses **Express.js** with **TypeScript** in an API-first design pattern. The server implements a RESTful architecture with dedicated route handlers for authentication, video operations, chat functionality, and job management. Middleware handles authentication, rate limiting, and error processing. The application follows a service-oriented pattern with separate modules for OpenAI integration and Kie.ai video generation services.

### Database Design
The system uses **PostgreSQL** with **Drizzle ORM** for type-safe database operations. The schema includes four main entities: sessions (for authentication), users (profile data), jobs (video generation tracking), and videos (content metadata). The database uses UUIDs for primary keys and includes proper foreign key relationships. Session storage is handled through PostgreSQL for scalability and persistence.

### Authentication System
Authentication is implemented using **Replit Auth** with OpenID Connect protocol. The system uses **Passport.js** with session-based authentication stored in PostgreSQL. User sessions are managed with secure HTTP-only cookies and include proper CSRF protection. The authentication flow supports automatic user creation and profile updates through the OpenID Connect provider.

### Video Processing Workflow
Video generation follows an asynchronous job processing pattern. Users submit prompts through a chat interface that refines requests using OpenAI's GPT-5. Refined prompts are sent to Kie.ai's Veo3 Fast API, which returns a task ID for tracking. The system implements webhook callbacks to update job status and store video metadata. Videos are served directly from Kie.ai's CDN URLs without local storage.

### Real-time Features
The application implements polling-based real-time updates for job status and video availability. The frontend uses React Query with configurable refetch intervals to provide live progress updates. This approach ensures users see immediate feedback during video generation without requiring WebSocket infrastructure.

## External Dependencies

### AI Services
- **OpenAI API**: GPT-5 model for chat assistance and prompt refinement with JSON response formatting
- **Kie.ai Video API**: Veo3 Fast model for video generation with webhook callback support

### Database and Storage
- **Neon PostgreSQL**: Serverless PostgreSQL database for production scalability
- **Drizzle ORM**: Type-safe database operations with migration support

### Authentication
- **Replit Auth**: OpenID Connect authentication provider with automatic user provisioning
- **Passport.js**: Authentication middleware with session management

### UI and Styling
- **shadcn/ui**: React component library built on Radix UI primitives
- **Tailwind CSS**: Utility-first CSS framework with custom design system
- **Video.js**: Professional video player for media playback

### Development Tools
- **Vite**: Modern build tool with hot reload and TypeScript support
- **React Query**: Server state management with caching and synchronization
- **Zod**: Runtime type validation for API schemas and form validation

### Session Management
- **connect-pg-simple**: PostgreSQL session store for Express sessions
- **express-session**: Session middleware with secure cookie configuration