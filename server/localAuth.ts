import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  return session({
    secret: process.env.SESSION_SECRET || 'fallback-secret-for-dev',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: !isDevelopment, // false in development, true in production
      sameSite: isDevelopment ? 'lax' : 'none', // lax for dev, none for production with HTTPS
      maxAge: sessionTtl,
    },
  });
}

export async function setupLocalAuth(app: Express) {
  app.set("trust proxy", 1);
  
  // Set auth provider to local by default
  process.env.AUTH_PROVIDER = process.env.AUTH_PROVIDER || 'local';
  
  // Enable CORS with credentials
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });
  
  app.use(getSession());
}

// Helper function to get userId from local session only
export function getUserId(req: any): string | null {
  return req.session?.userId || null;
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const session = (req as any).session;
  
  // Check for local auth session only
  if (session?.userId) {
    return next();
  }
  
  return res.status(401).json({ message: "Unauthorized" });
};