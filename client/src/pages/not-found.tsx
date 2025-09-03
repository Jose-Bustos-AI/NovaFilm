import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, Home } from "lucide-react";

export default function NotFound() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2 items-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <h1 className="text-2xl font-bold">404 Página No Encontrada</h1>
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            La página que buscas no existe. Te redirigiremos al inicio en unos segundos...
          </p>

          <div className="mt-6 flex gap-2">
            <Button 
              onClick={() => navigate('/')}
              className="flex-1 gap-2"
            >
              <Home className="h-4 w-4" />
              Ir al Inicio
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
