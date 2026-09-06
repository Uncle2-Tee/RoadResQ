# RoadResQ / BreakdownAssist

RoadResQ is a mobile roadside-assistance platform for drivers, mechanics, towing providers, and administrators. Drivers can discover nearby providers, request mechanic or towing help, communicate with providers, pay through Paystack, and track payment history. Mechanics and towing providers can register their businesses, receive requests, accept or decline jobs, and manage their service workflows. Administrators review provider registrations and release completed provider payments.

The repository contains two applications:

- **Backend:** Next.js API routes with Prisma and PostgreSQL.
- **Frontend:** Expo Router / React Native mobile application.

## Features

- Driver, mechanic, tower, and administrator roles
- Email/password authentication with active-session protection
- Mechanic-shop and towing-company registration
- Admin approval workflow for provider registrations
- Nearby provider discovery using device location and distance calculations
- Mechanic service requests and towing requests
- Request status synchronization between drivers and providers
- Expo push notifications for new provider requests
- In-app mechanic/provider communication flows
- Paystack checkout and payment verification
- Payment history and administrator payment-release workflow
- Duplicate-payment protection and payment-session cancellation
- Offline request/payment caching and queued synchronization
- Profile photo support and responsive mobile layouts

## Repository Structure

```text
BreakdownAssistApp/
├── app/                         # Next.js API route handlers
│   └── api/
├── frontend/                    # Expo React Native client
│   ├── app/                     # Expo Router screens
│   ├── components/              # Shared UI components
│   ├── hooks/                   # Reusable React hooks
│   ├── services/                # API, location, notifications, sync, payment logic
│   └── assets/                  # Images, sounds, and app assets
├── lib/                         # Prisma, authentication, Paystack, push helpers
├── prisma/
│   └── schema.prisma            # PostgreSQL data model
├── scripts/                     # Database repair and maintenance scripts
├── package.json                 # Backend commands and dependencies
├── prisma.config.ts             # Prisma datasource configuration
└── frontend/package.json        # Mobile client commands and dependencies
```

## Prerequisites

- Node.js 20 or newer
- npm
- PostgreSQL, or access to a hosted PostgreSQL database such as Supabase
- Android Studio and an Android emulator, or a physical Android device
- Xcode and an iOS simulator for iOS development
- An Expo-compatible development environment
- A Paystack account and API key for real payments

For Android development, Android Studio must have an emulator configured. For a physical device, the phone and development computer must be on the same local network.

## Installation

Install backend dependencies from the repository root:

```bash
npm install
```

Install frontend dependencies:

```bash
cd frontend
npm install
cd ..
```

## Environment Configuration

### Backend environment

Create a `.env` file in the repository root. Do not commit it.

```env
ADMIN_EMAIL=admin@example.com
DATABASE_URL=postgresql://USER:PASSWORD@HOST:6543/postgres?pgbouncer=true&connection_limit=1&sslmode=require
DIRECT_URL=postgresql://USER:PASSWORD@HOST:5432/postgres?sslmode=require
PAYSTACK_SECRET_KEY=sk_test_your_secret_key
PLATFORM_FEE_GHS=0
PLATFORM_COMMISSION_RATE=0.1
PAYSTACK_CALLBACK_URL=http://YOUR_HOST_IP:3000/api/payments/verify
```

Use the pooled URL for normal application traffic. `DIRECT_URL` is used when running schema operations that require a direct PostgreSQL connection.

Never commit database passwords, Paystack keys, or administrator credentials. If a live secret has been exposed, revoke and rotate it in the provider dashboard before using the project again.

### Frontend environment

Create `frontend/.env`:

```env
EXPO_PUBLIC_API_URL=http://YOUR_HOST_IP:3000
```

Use the correct backend address for the device running Expo:

| Client | API URL |
| --- | --- |
| Android emulator | `http://10.0.2.2:3000` |
| iOS simulator | `http://localhost:3000` |
| Physical Android/iOS device | `http://YOUR_COMPUTER_LAN_IP:3000` |

The backend listens on all interfaces through `next dev -H 0.0.0.0`, which allows a physical device to connect over the local network. Windows Firewall may need an inbound rule for Node.js or port `3000`.

## Database Setup

The current schema uses PostgreSQL. Prisma reads the database URL from `prisma.config.ts`.

Generate the Prisma client:

```bash
npm run db:generate
```

Apply the Prisma schema to the configured database:

```bash
npm run db:push
```

For schema changes that need the direct database connection on Windows:

```powershell
$env:USE_DIRECT_URL='true'
npx prisma db push
```

The payment release fields are already part of `prisma/schema.prisma`. If an existing database is missing them, run:

```bash
node scripts/repair-payment-schema.cjs
```

That script adds and verifies `releaseStatus`, `releasedAt`, and `releaseNote` on the `Payment` table.

### Main database models

- `User`: driver, mechanic, tower, and admin accounts
- `RequestHistory`: mechanic, tow, call, SMS, and chat request records
- `MechanicShop`: mechanic business profiles and approval/bank details
- `TowShop`: towing business profiles and approval/bank details
- `Payment`: Paystack and other payment records, provider amounts, and release state
- `PushToken`: Expo push tokens for provider notifications
- `PasswordResetToken`: password-reset token records

## Running the Applications

Run the backend from the repository root:

```bash
npm run dev
```

The API is available at:

```text
http://localhost:3000
```

Run the frontend in a second terminal:

```bash
cd frontend
npm start
```

Useful frontend commands:

```bash
npm run android
npm run ios
npm run web
npm run lint
```

Useful backend commands:

```bash
npm run dev
npm run build
npm run start
npm run db:generate
npm run db:push
```

Check the backend health endpoint before opening the mobile app:

```text
GET http://localhost:3000/api/health
```

## User Workflows

### Driver

1. Sign up or log in as a driver.
2. Allow location access when prompted.
3. Browse nearby mechanic shops and towing companies.
4. Contact a provider or create a mechanic/tow request.
5. Wait for the provider to accept the request.
6. Open Payment and select the specific accepted request.
7. Enter an agreed amount for mechanic services when no quote is stored. Tow requests use their stored price.
8. Complete Paystack checkout and verify the payment.
9. View completed payments in Transaction History.

The payment screen links a payment to a request using its `requestId`. A request with a completed payment is removed from the payment selector and cannot be paid again.

### Mechanic or tower

1. Register an account and provider shop profile.
2. Wait for administrator approval where required.
3. Sign in and keep the provider dashboard or inbox available.
4. Receive service/tow notifications.
5. Accept or decline requests.
6. Complete the service and allow the driver to make payment.

### Administrator

1. Configure `ADMIN_EMAIL` to the administrator account email.
2. Log in with an account whose role is `admin`.
3. Review provider registrations in the Registrations tab.
4. Review completed payments in Payment Release.
5. Release or reject eligible provider payments.

Payment release is allowed only when the payment is completed and the linked service request has status `accepted`.

## Payment Flow

The payment lifecycle is:

1. The app loads accepted/confirmed requests for the current driver.
2. The driver explicitly selects one request.
3. The frontend sends its `requestId` to `/api/payments/initialize`.
4. The backend verifies that the request exists, belongs to the driver, and is payable.
5. The backend creates a Paystack transaction and stores a processing `Payment` record.
6. The server-generated Paystack reference identifies the checkout session.
7. The app verifies the transaction through `/api/payments/verify/[reference]`.
8. Successful verification marks the payment `COMPLETED`.
9. The administrator can later release the provider amount.

Safeguards include:

- Explicit request selection instead of silently choosing the newest request
- Driver/request ownership checks
- Request status validation
- Duplicate active-payment protection using a PostgreSQL advisory lock
- One-minute expiry for abandoned processing sessions
- Explicit checkout cancellation
- Completed-request filtering on the payment screen

## API Route Groups

The backend exposes these route groups under `app/api`:

| Route group | Purpose |
| --- | --- |
| `/api/health` | Backend/database health check |
| `/api/auth` | Signup, login, session, profile, email, and password-reset operations |
| `/api/requests` | Create, list, and update mechanic/tow/contact request history |
| `/api/mechanic-shops` | Mechanic-shop registration, listing, and profile operations |
| `/api/payments` | Payment creation, listing, cancellation, and verification support |
| `/api/payments/initialize` | Validate a request and initialize Paystack checkout |
| `/api/payments/verify/[reference]` | Verify a Paystack transaction and complete the payment |
| `/api/paystack` | Paystack-related provider operations |
| `/api/push-tokens` | Register and remove Expo push tokens |
| `/api/admin` | Administrator registration approval and payment-release operations |

## Important Frontend Services

- `frontend/services/api-client.ts`: API requests, caching, offline queue, and response types
- `frontend/services/request-history-recorder.ts`: local request creation and backend synchronization
- `frontend/services/payment-receipt-recorder.ts`: payable-request selection, checkout, verification, and cancellation
- `frontend/services/location-service.ts`: nearby provider lookup and location handling
- `frontend/services/push-notifications.ts`: Expo notification registration and handling
- `frontend/services/request-sync.ts`: request visibility and local synchronization events
- `frontend/services/payment-history-sync.ts`: payment-history refresh events
- `frontend/services/smart-utils.ts`: validation, formatting, retry, distance, and utility functions

## Troubleshooting

### The mobile app says “Network request failed”

- Confirm the backend is running on port `3000`.
- Confirm `frontend/.env` points to the correct host for the emulator or device.
- For a physical device, use the computer’s LAN IP, not `localhost`.
- Make sure the device and computer share the same network.
- Check Windows Firewall and router isolation settings.
- Use the backend health endpoint from the same network.

### Payment approvals are unavailable

- Confirm the database is reachable.
- Run `npm run db:generate`.
- Run `node scripts/repair-payment-schema.cjs` if payment release columns are missing.
- Restart the backend after schema changes.

### A payment says it is already in progress

The request already has a processing or completed payment. Close the Paystack checkout and choose **Cancel payment** to retry. Abandoned processing sessions expire automatically after one minute; restart the backend after changing expiry code.

### No request appears on the Payment screen

Only accepted mechanic requests and confirmed/accepted tow requests with valid pricing are payable. Confirm that:

- The provider accepted the request.
- The request was synchronized to the backend.
- A price exists for a tow request, or an amount is entered for a mechanic request.
- The driver is signed into the same account that created the request.

### Push notifications do not arrive

- Confirm notification permission was granted.
- Confirm the provider has a valid Expo push token.
- Confirm the provider account ID is linked to the request.
- Check the backend logs for Expo push errors.

### Prisma cannot connect

- Check `DATABASE_URL` and `DIRECT_URL`.
- Confirm the hosted PostgreSQL database is online.
- Use the direct URL for schema pushes when the pooler rejects DDL operations.
- Check SSL, firewall, and network settings.

## Existing Documentation

- [Frontend API setup guide](frontend/API_SETUP_GUIDE.md): device networking and API URL troubleshooting.
- [Frontend smart features](frontend/SMART_FEATURES.md): responsive hooks, validation, retry utilities, and distance helpers.
- [Frontend README](frontend/README.md): basic Expo documentation from the original scaffold.

`frontend/BACKEND_INTEGRATION.md` contains an older Express/SQLite architecture description and should not be used as the current setup guide. The active backend is Next.js with Prisma and PostgreSQL as described in this README.

## Development Notes

- Keep backend and frontend running in separate terminals.
- Restart the backend after changing environment variables or server-side code when hot reload does not pick up the change.
- Do not commit `.env`, `frontend/.env`, database credentials, Paystack keys, or generated local state.
- The `.expo` directory is machine-specific and should remain uncommitted.
- Use test Paystack keys during development. Live keys should only be used in a controlled deployment environment.
