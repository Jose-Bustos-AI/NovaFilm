# Integración de Stripe - NovaFilm

## Configuración de Secrets

Las siguientes variables de entorno son necesarias para la integración de Stripe:

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_BASIC=price_1S3Z5SDJnK8wh0ivGhvP3A5I
STRIPE_PRICE_PRO=price_1S3Z63DJnK8wh0iveEKgnZIM
STRIPE_PRICE_MAX=price_1S3Z6dDJnK8wh0ivd1v67UJC
APP_BASE_URL=https://tu-repl.replit.dev
```

## URL de Webhook para Stripe

Configura el siguiente endpoint en tu dashboard de Stripe (Developers > Webhooks):

```
https://tu-repl.replit.dev/api/stripe/webhook
```

### Eventos a escuchar:
- `checkout.session.completed`
- `invoice.payment_succeeded`
- `customer.subscription.deleted`

## Planes de Suscripción

| Plan | Precio | Créditos/Mes | Price ID |
|------|---------|--------------|----------|
| BASIC | €4.97 | 5 créditos | price_1S3Z5SDJnK8wh0ivGhvP3A5I |
| PRO | €9.97 | 12 créditos | price_1S3Z63DJnK8wh0iveEKgnZIM |
| MAX | €19.97 | 30 créditos | price_1S3Z6dDJnK8wh0ivd1v67UJC |

## Flujo de Suscripción

1. **Usuario ve planes** → GET `/api/billing/plans`
2. **Usuario selecciona plan** → POST `/api/billing/checkout`
3. **Stripe procesa pago** → Webhook `invoice.payment_succeeded`
4. **Sistema otorga créditos** → Automático vía webhook
5. **Usuario recibe notificación** → UI actualizada

## Endpoints Implementados

### GET /api/billing/plans
Retorna los planes disponibles con precios y créditos.

### POST /api/billing/checkout
Crea una sesión de checkout de Stripe para el plan seleccionado.
Body: `{ "planKey": "basic" | "pro" | "max" }`

### POST /api/stripe/webhook
Maneja eventos de Stripe con verificación de firma e idempotencia.

## Base de Datos

### Nuevas columnas en `users`:
- `active_plan`: Plan activo del usuario
- `credits_renew_at`: Fecha de próxima renovación

### Nueva tabla `stripe_events`:
- `id`: ID del evento de Stripe
- `type`: Tipo de evento
- `payload`: Datos del evento
- `created_at`: Fecha de procesamiento

## Uso de la UI

La sección de "Planes y Suscripción" aparece en la página Mi Cuenta, mostrando:
- Estado actual de suscripción
- Tres planes disponibles con precios
- Botones para suscribirse
- Indicador visual del plan actual