# Frontend Backend Integration Guide

This guide explains how the signup page connects to the Prisma backend database through API routes.

## Architecture

```
React Native App (signup.tsx)
        ↓
    API Client (api-client.ts)
        ↓
  Backend Express Server (index.js)
        ↓
  Auth Routes (routes/auth.js)
        ↓
  User Service (services/userService.js)
        ↓
    Prisma Client
        ↓
   SQLite Database (dev.db)
```

## Setup Instructions

### 1. Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Create database and apply schema
npm run prisma:push

# Seed database with sample data
npm run prisma:seed
```

### 2. Start Backend Server

**Development Mode (with auto-reload):**
```bash
cd backend
npm run dev
```

The server will start on `http://localhost:3000`

**Production Mode:**
```bash
cd backend
npm start
```

### 3. Frontend Configuration

In the root `.env` file, set the backend URL:

```env
EXPO_PUBLIC_API_URL=http://localhost:3000
```

For production, replace with your actual backend URL:
```env
EXPO_PUBLIC_API_URL=https://api.yourserver.com
```

### 4. Start Frontend App

```bash
npm start
# Then select your platform (iOS, Android, or Web)
```

## How Signup Works

### Step 1: User Fills Form
User enters fullName, email, phone, role, password in signup.tsx

### Step 2: Form Validation
- Check all fields are filled
- Validate email format
- Verify passwords match
- Minimum password length

### Step 3: Email Availability Check
```typescript
const emailAvailable = await checkEmailAvailability(normalizedEmail);
```
Calls `POST /api/auth/check-email` to verify email is not already registered

### Step 4: Signup API Call
```typescript
const user = await signup({
  fullName: "John Doe",
  email: "john@example.com",
  phone: "+233551234567",
  password: "password123",
  confirmPassword: "password123",
  role: "driver",
});
```

### Step 5: Backend Processing
1. **Route Handler** (`routes/auth.js`):
   - Validates request data
   - Checks password requirements

2. **User Service** (`services/userService.js`):
   - Hashes password using bcryptjs
   - Checks if user already exists
   - Creates user with Prisma

3. **Database** (`prisma/schema.prisma`):
   - Stores user data in SQLite

### Step 6: Store User Data Locally
Successfully created user is stored in AsyncStorage:
```typescript
await AsyncStorage.multiSet([
  ['userId', user.id],
  ['driverName', user.name],
  ['driverPhone', user.phone],
  ['currentUserEmail', user.email],
  ['userRole', user.role],
]);
```

### Step 7: Navigation
User is redirected to login page to authenticate

## API Endpoints

### Signup
**POST** `/api/auth/signup`
```json
{
  "fullName": "John Doe",
  "email": "john@example.com",
  "phone": "+233551234567",
  "password": "password123",
  "confirmPassword": "password123",
  "role": "driver"
}
```

### Login
**POST** `/api/auth/login`
```json
{
  "email": "john@example.com",
  "password": "password123"
}
```

### Get User Profile
**GET** `/api/auth/user/{userId}`

### Update User Profile
**PUT** `/api/auth/user/{userId}`
```json
{
  "name": "John Updated",
  "phone": "+233551234999"
}
```

### Check Email
**POST** `/api/auth/check-email`
```json
{
  "email": "john@example.com"
}
```

## Database Structure

### User Table
```
id (primary key - CUID)
email (unique)
name
phone
password (hashed)
role (driver/mechanic)
createdAt
updatedAt
```

### Related Tables
- ServiceRequest - Driver service requests
- TowRequest - Towing requests
- MechanicShop - Registered mechanics
- Payment - Payment records
- Message - User messages

## Testing

### Test with Sample Data
After seeding, you can login using:

**Driver:**
- Email: driver1@example.com
- Password: password123

**Mechanic:**
- Email: mechanic1@example.com
- Password: password123

### Manual API Testing (Postman/Insomnia)

1. **Create New User:**
   - Method: POST
   - URL: http://localhost:3000/api/auth/signup
   - Body:
   ```json
   {
     "fullName": "Test User",
     "email": "test@example.com",
     "phone": "+233551234567",
     "password": "testpass123",
     "confirmPassword": "testpass123",
     "role": "driver"
   }
   ```

2. **Login:**
   - Method: POST
   - URL: http://localhost:3000/api/auth/login
   - Body:
   ```json
   {
     "email": "test@example.com",
     "password": "testpass123"
   }
   ```

## Troubleshooting

### Port Already in Use
```bash
# Find process using port 3000
lsof -i :3000

# Kill process
kill -9 <PID>
```

### Database Connection Error
- Check `.env` has correct DATABASE_URL
- Ensure database file exists: `backend/dev.db`
- Try resetting: `npm run prisma:migrate`

### CORS Errors
Backend has CORS enabled for all origins by default. For production, restrict in `index.js`:
```javascript
app.use(cors({
  origin: 'https://yourdomain.com'
}));
```

### API Not Responding
1. Verify backend is running: `npm run dev`
2. Check `EXPO_PUBLIC_API_URL` in frontend `.env`
3. For Android: Use `10.0.2.2:3000` instead of `localhost:3000`
4. For iOS simulator: Use `localhost:3000`
5. For physical device: Use actual machine IP address

### Password Hash Issues
Passwords are automatically hashed with bcryptjs. Never store plain passwords.

## Next Steps

1. ✅ Setup backend with Prisma
2. ✅ Create API routes for signup/login
3. ✅ Connect frontend to API
4. [ ] Create login page API integration
5. [ ] Add JWT token authentication
6. [ ] Implement password reset
7. [ ] Add email verification
8. [ ] Deploy backend to production

## Production Deployment

### Backend Deployment (Heroku/Render/Railway example)

1. Create account on hosting platform
2. Set environment variable:
   ```
   DATABASE_URL=postgresql://user:pass@host:5432/db
   ```
3. Deploy:
   ```bash
   git push heroku main
   ```

### Switching Database to PostgreSQL

In `prisma/schema.prisma`:
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Then run:
```bash
npm run prisma:push
npm run prisma:seed
```

## Security Checklist

- [ ] Passwords hash with bcryptjs (✅ Done)
- [ ] Input validation (✅ Done)  
- [ ] Error messages don't leak info (✅ Done)
- [ ] HTTPS in production
- [ ] Implement JWT tokens
- [ ] Add rate limiting
- [ ] Add CORS restrictions
- [ ] Use environment variables for secrets
- [ ] Implement password strength requirements
- [ ] Add email verification
- [ ] Add 2FA option

## Support

For issues or questions:
1. Check API_DOCUMENTATION.md
2. Review backend logs: `npm run dev`
3. Check frontend console logs
4. Verify database with: `npm run prisma:studio`
