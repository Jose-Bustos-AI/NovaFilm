import { useState } from 'react';
import * as React from 'react';
import { useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { ArrowLeft } from 'lucide-react';

interface UserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  profileImageUrl: string;
  plan: string;
  creditsRemaining: number;
  subscriptionStatus: string;
  createdAt: string;
  hasPassword: boolean;
}

interface CreditEntry {
  delta: number;
  reason: string;
  jobId: string | null;
  createdAt: string;
}

interface CreditsData {
  creditsRemaining: number;
  ledger: CreditEntry[];
}

export function AccountPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    firstName: '',
    lastName: '',
    profileImageUrl: ''
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  // Fetch user profile
  const { data: profile, isLoading: profileLoading, error: profileError } = useQuery<UserProfile>({
    queryKey: ['/api/account/me']
  });

  // Update form when profile loads
  React.useEffect(() => {
    if (profile) {
      setEditForm({
        firstName: profile.firstName || '',
        lastName: profile.lastName || '',
        profileImageUrl: profile.profileImageUrl || ''
      });
    }
  }, [profile]);

  // Fetch credits data
  const { data: creditsData, isLoading: creditsLoading } = useQuery<CreditsData>({
    queryKey: ['/api/account/credits']
  });

  // Update profile mutation
  const updateProfileMutation = useMutation({
    mutationFn: (updates: any) => apiRequest('/api/account/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/account/me'] });
      setIsEditing(false);
      toast({
        title: "Perfil actualizado",
        description: "Tus datos se han guardado correctamente."
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo actualizar el perfil. Intenta de nuevo.",
        variant: "destructive"
      });
    }
  });

  // Cancel subscription mutation
  const cancelSubscriptionMutation = useMutation({
    mutationFn: () => apiRequest('/api/account/subscription/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/account/me'] });
      toast({
        title: "Suscripción cancelada",
        description: "Tu suscripción ha sido cancelada. Mantienes acceso hasta fin de ciclo."
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo cancelar la suscripción. Intenta de nuevo.",
        variant: "destructive"
      });
    }
  });

  // Logout mutation
  const logoutMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/auth/logout', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      queryClient.invalidateQueries({ queryKey: ['/api/account/me'] });
      queryClient.clear(); // Clear all cached data
      
      toast({
        title: "Sesión cerrada",
        description: "Has cerrado sesión exitosamente.",
      });
      
      navigate('/');
    },
    onError: () => {
      toast({
        title: "Error",
        description: "No se pudo cerrar la sesión. Intenta de nuevo.",
        variant: "destructive"
      });
    }
  });

  // Change password mutation
  const changePasswordMutation = useMutation({
    mutationFn: (data: {currentPassword: string, newPassword: string}) => 
      apiRequest('POST', '/api/account/change-password', data),
    onSuccess: () => {
      toast({
        title: "Contraseña actualizada",
        description: "Tu contraseña ha sido cambiada exitosamente."
      });
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setShowPasswordForm(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "No se pudo cambiar la contraseña.",
        variant: "destructive"
      });
    }
  });

  // Set password mutation (for users without password)
  const setPasswordMutation = useMutation({
    mutationFn: (data: {newPassword: string}) => 
      apiRequest('POST', '/api/account/set-password', data),
    onSuccess: () => {
      toast({
        title: "Contraseña establecida",
        description: "Tu contraseña ha sido establecida exitosamente."
      });
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setShowPasswordForm(false);
      queryClient.invalidateQueries({ queryKey: ['/api/account/me'] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "No se pudo establecer la contraseña.",
        variant: "destructive"
      });
    }
  });

  const handleUpdateProfile = () => {
    const cleanData: any = {};
    if (editForm.firstName.trim()) cleanData.firstName = editForm.firstName.trim();
    if (editForm.lastName.trim()) cleanData.lastName = editForm.lastName.trim();
    if (editForm.profileImageUrl.trim()) cleanData.profileImageUrl = editForm.profileImageUrl.trim();
    
    updateProfileMutation.mutate(cleanData);
  };

  const handleChangePassword = () => {
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast({
        title: "Error",
        description: "Las contraseñas no coinciden.",
        variant: "destructive"
      });
      return;
    }

    if (passwordForm.newPassword.length < 8) {
      toast({
        title: "Error", 
        description: "La nueva contraseña debe tener al menos 8 caracteres.",
        variant: "destructive"
      });
      return;
    }

    // Use different mutation based on whether user has password or not
    if (profile?.hasPassword) {
      changePasswordMutation.mutate({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword
      });
    } else {
      setPasswordMutation.mutate({
        newPassword: passwordForm.newPassword
      });
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const getReasonText = (reason: string) => {
    const reasons: Record<string, string> = {
      'video_generation': 'Generación de video',
      'promo': 'Bienvenida',
      'manual_grant': 'Recarga manual',
      'refund': 'Reembolso'
    };
    return reasons[reason] || reason;
  };

  const getSubscriptionStatusBadge = (status: string) => {
    const variants: Record<string, any> = {
      'inactive': { variant: 'secondary', text: 'Free' },
      'trialing': { variant: 'default', text: 'Trial' },
      'active': { variant: 'default', text: 'Active' },
      'canceled': { variant: 'destructive', text: 'Canceled' }
    };
    const config = variants[status] || variants.inactive;
    return <Badge variant={config.variant}>{config.text}</Badge>;
  };

  if (profileLoading) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="space-y-6">
          <div className="h-8 bg-muted rounded w-48"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="h-64 bg-muted rounded"></div>
            <div className="h-64 bg-muted rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (profileError || !profile) {
    return (
      <div className="container mx-auto py-8 px-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-muted-foreground">Error al cargar el perfil de usuario.</p>
              <Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>
                Reintentar
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4 space-y-6">
      <div className="flex items-center gap-4 mb-2">
        <Button 
          variant="ghost" 
          size="sm"
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
          aria-label="Volver al Dashboard"
          data-testid="button-back-dashboard"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver
        </Button>
      </div>
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold" data-testid="text-page-title">Mi Cuenta</h1>
        <Button 
          variant="outline" 
          onClick={() => logoutMutation.mutate()}
          disabled={logoutMutation.isPending}
          data-testid="button-logout"
        >
          {logoutMutation.isPending ? 'Cerrando...' : 'Cerrar Sesión'}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Profile Card */}
        <Card>
          <CardHeader>
            <CardTitle>Perfil</CardTitle>
            <CardDescription>Gestiona tu información personal</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center space-x-4">
              <Avatar className="h-16 w-16">
                <AvatarImage src={profile.profileImageUrl} />
                <AvatarFallback className="text-lg">
                  {((profile.firstName?.[0] || '') + (profile.lastName?.[0] || '')).toUpperCase() || profile.email?.[0]?.toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div>
                <h3 className="text-lg font-medium" data-testid="text-user-name">
                  {profile.firstName || profile.lastName 
                    ? `${profile.firstName || ''} ${profile.lastName || ''}`.trim()
                    : 'Sin nombre'}
                </h3>
                <p className="text-sm text-muted-foreground" data-testid="text-user-email">
                  {profile.email}
                </p>
                <div className="flex items-center space-x-2 mt-1">
                  {getSubscriptionStatusBadge(profile.subscriptionStatus)}
                  <span className="text-sm text-muted-foreground">
                    Miembro desde {formatDate(profile.createdAt)}
                  </span>
                </div>
              </div>
            </div>

            <Separator />

            {isEditing ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="firstName">Nombre</Label>
                    <Input
                      id="firstName"
                      value={editForm.firstName}
                      onChange={(e) => setEditForm({...editForm, firstName: e.target.value})}
                      placeholder="Tu nombre"
                      data-testid="input-first-name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="lastName">Apellido</Label>
                    <Input
                      id="lastName"
                      value={editForm.lastName}
                      onChange={(e) => setEditForm({...editForm, lastName: e.target.value})}
                      placeholder="Tu apellido"
                      data-testid="input-last-name"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="profileImage">URL del Avatar</Label>
                  <Input
                    id="profileImage"
                    value={editForm.profileImageUrl}
                    onChange={(e) => setEditForm({...editForm, profileImageUrl: e.target.value})}
                    placeholder="https://ejemplo.com/tu-avatar.jpg"
                    data-testid="input-avatar-url"
                  />
                </div>
                <div className="flex space-x-2">
                  <Button 
                    onClick={handleUpdateProfile} 
                    disabled={updateProfileMutation.isPending}
                    data-testid="button-save-profile"
                  >
                    {updateProfileMutation.isPending ? 'Guardando...' : 'Guardar'}
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={() => setIsEditing(false)}
                    data-testid="button-cancel-edit"
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <Button 
                onClick={() => setIsEditing(true)}
                data-testid="button-edit-profile"
              >
                Editar Perfil
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Password Change Card */}
        <Card>
          <CardHeader>
            <CardTitle>Seguridad</CardTitle>
            <CardDescription>
              {profile?.hasPassword 
                ? "Cambia tu contraseña para mantener tu cuenta segura"
                : "Establece una contraseña para acceder a tu cuenta de forma independiente"
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            {showPasswordForm ? (
              <div className="space-y-4">
                {profile?.hasPassword && (
                  <div>
                    <Label htmlFor="currentPassword">Contraseña Actual</Label>
                    <Input
                      id="currentPassword"
                      type="password"
                      value={passwordForm.currentPassword}
                      onChange={(e) => setPasswordForm({...passwordForm, currentPassword: e.target.value})}
                      placeholder="Ingresa tu contraseña actual"
                      data-testid="input-current-password"
                    />
                  </div>
                )}
                <div>
                  <Label htmlFor="newPassword">
                    {profile?.hasPassword ? "Nueva Contraseña" : "Contraseña"}
                  </Label>
                  <Input
                    id="newPassword"
                    type="password"
                    value={passwordForm.newPassword}
                    onChange={(e) => setPasswordForm({...passwordForm, newPassword: e.target.value})}
                    placeholder="Mínimo 8 caracteres"
                    data-testid="input-new-password"
                  />
                </div>
                <div>
                  <Label htmlFor="confirmPassword">
                    {profile?.hasPassword ? "Confirmar Nueva Contraseña" : "Confirmar Contraseña"}
                  </Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={passwordForm.confirmPassword}
                    onChange={(e) => setPasswordForm({...passwordForm, confirmPassword: e.target.value})}
                    placeholder="Repite la contraseña"
                    data-testid="input-confirm-password"
                  />
                </div>
                <div className="flex space-x-2">
                  <Button 
                    onClick={handleChangePassword}
                    disabled={
                      (changePasswordMutation.isPending || setPasswordMutation.isPending) ||
                      (profile?.hasPassword 
                        ? (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword)
                        : (!passwordForm.newPassword || !passwordForm.confirmPassword)
                      )
                    }
                    data-testid="button-save-password"
                  >
                    {(changePasswordMutation.isPending || setPasswordMutation.isPending) 
                      ? 'Guardando...' 
                      : (profile?.hasPassword ? 'Cambiar Contraseña' : 'Establecer Contraseña')
                    }
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={() => {
                      setShowPasswordForm(false);
                      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
                    }}
                    data-testid="button-cancel-password"
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <Button 
                onClick={() => setShowPasswordForm(true)}
                data-testid="button-change-password"
              >
                {profile?.hasPassword ? 'Cambiar Contraseña' : 'Establecer Contraseña'}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Credits Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Créditos
              <span className="text-2xl font-bold text-primary" data-testid="text-credits-balance">
                {creditsLoading ? '...' : (creditsData?.creditsRemaining ?? 0)}
              </span>
            </CardTitle>
            <CardDescription>
              Cada crédito te permite generar un video
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex space-x-2">
              <Button className="flex-1" data-testid="button-add-credits">
                Añadir Créditos
              </Button>
              {profile.subscriptionStatus === 'active' && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" data-testid="button-cancel-subscription">
                      Cancelar Suscripción
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>¿Cancelar suscripción?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Tu suscripción se cancelará pero mantienes acceso hasta el fin de tu ciclo actual.
                        No se realizarán más cobros.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>No, mantener</AlertDialogCancel>
                      <AlertDialogAction 
                        onClick={() => cancelSubscriptionMutation.mutate()}
                        className="bg-destructive hover:bg-destructive/90"
                      >
                        Sí, cancelar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>

            {!creditsLoading && creditsData && creditsData.ledger.length > 0 && (
              <>
                <Separator />
                <div>
                  <h4 className="text-sm font-medium mb-3">Historial de Créditos</h4>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {creditsData.ledger.slice(0, 10).map((entry, index) => (
                      <div key={index} className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50">
                        <div>
                          <span className="text-sm font-medium">
                            {getReasonText(entry.reason)}
                          </span>
                          <div className="text-xs text-muted-foreground">
                            {formatDate(entry.createdAt)}
                          </div>
                        </div>
                        <span className={`text-sm font-medium ${
                          entry.delta > 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {entry.delta > 0 ? '+' : ''}{entry.delta}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}